"use client"

import * as React from "react"

type AutoGrowTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minHeight?: number
}

export const AutoGrowTextarea = React.forwardRef<HTMLTextAreaElement, AutoGrowTextareaProps>(
  function AutoGrowTextarea({ minHeight = 120, style, onChange, ...props }, forwardedRef) {
    const innerRef = React.useRef<HTMLTextAreaElement>(null)

    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node
        if (typeof forwardedRef === "function") {
          forwardedRef(node)
        } else if (forwardedRef) {
          forwardedRef.current = node
        }
      },
      [forwardedRef]
    )

    const resize = React.useCallback(() => {
      const el = innerRef.current
      if (!el) return
      el.style.height = "0px"
      el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`
    }, [minHeight])

    React.useLayoutEffect(() => {
      resize()
    }, [resize, props.value])

    return (
      <textarea
        {...props}
        ref={setRefs}
        onChange={(event) => {
          onChange?.(event)
          resize()
        }}
        style={style}
      />
    )
  }
)
