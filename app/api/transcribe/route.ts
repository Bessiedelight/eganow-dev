import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as Blob;
    
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY is not configured' }, { status: 500 });
    }

    // 1. Transcribe the audio via Groq Whisper
    const sttFormData = new FormData();
    sttFormData.append('file', audioFile, 'recording.webm');
    sttFormData.append('model', 'whisper-large-v3');

    const sttResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqKey}`,
      },
      body: sttFormData,
    });

    if (!sttResponse.ok) {
      const errorText = await sttResponse.text();
      throw new Error(`Groq STT API Error: ${errorText}`);
    }

    const sttData = await sttResponse.json();
    const transcript = sttData.text;

    if (!transcript) {
      return NextResponse.json({ error: 'Transcription resulted in empty text.' }, { status: 400 });
    }

    // 2. Rewrite the transcription via Groq LLM (Llama 3 8B or 70B)
    const systemPrompt = `You are a strict dictation assistant. Your job is to take raw dictated notes from a user and convert them into a clean issue title and description.

CRITICAL INSTRUCTION 1: Do NOT hallucinate, invent, or add ANY details that the user did not explicitly mention. Remain absolutely strict to their original words while fixing minor grammar.
CRITICAL INSTRUCTION 2: For the description, NEVER use markdown headers (like # or ## or ###) and NEVER use bullet points (like -, *, +). If you need to list items, you MUST ONLY use numbered lists (1. , 2. , 3. ...).

You MUST format your response as a valid JSON object strictly matching this schema:
{
  "title": "A highly concise string summarizing the issue",
  "description": "A single string containing the rewritten notes, subject to the strict rules above"
}

Do NOT use custom keys like "summary" or "details". Use ONLY "title" and "description" keys mapped to plain strings. Do NOT wrap your JSON in markdown code blocks.`;

    const chatResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript },
        ],
        temperature: 0.2, // Lower temperature for strict JSON adherence
        response_format: { type: "json_object" }
      }),
    });

    if (!chatResponse.ok) {
      const errorText = await chatResponse.text();
      throw new Error(`Groq LLM API Error: ${errorText}`);
    }

    const chatData = await chatResponse.json();
    const resultText = chatData.choices[0].message.content;
    
    let parsedData: any = {};
    try {
      parsedData = JSON.parse(resultText.trim());
    } catch {
      // Fallback if the strict pipeline breaks entirely
      parsedData = { title: "Voice Transcription", description: resultText };
    }

    const titleRaw = parsedData.title || parsedData.summary || "Voice Issue";
    const finalTitle = typeof titleRaw === 'string' ? titleRaw : JSON.stringify(titleRaw);
    
    let finalDesc = "";
    if (parsedData.description && typeof parsedData.description === 'string') {
      finalDesc = parsedData.description;
    } else {
      // If the LLM hallucinated arbitrary keys (like "details" arrays), cleanly map them to markdown
      finalDesc = Object.entries(parsedData)
        .filter(([k]) => !['title', 'rawTranscript'].includes(k)) // Don't duplicate the title into the body
        .map(([k, v]) => {
          const header = `### ${k.charAt(0).toUpperCase() + k.slice(1)}`;
          if (typeof v === 'string') return `${header}\n${v}`;
          if (Array.isArray(v)) return `${header}\n${v.map((item: any) => `- ${item}`).join('\n')}`;
          return `${header}\n\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\``;
        })
        .join('\n\n');
        
      // If it yielded absolutely nothing else, dump everything to string
      if (!finalDesc.trim()) {
        finalDesc = typeof parsedData.description === 'string' 
          ? parsedData.description 
          : JSON.stringify(parsedData, null, 2);
      }
    }

    return NextResponse.json({
      title: finalTitle.replace(/^"|"$/g, '').trim(), // Strip straggling quotes
      description: finalDesc,
      rawTranscript: transcript
    });

  } catch (error: any) {
    console.error('Dictation error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
