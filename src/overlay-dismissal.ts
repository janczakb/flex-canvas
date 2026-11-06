import {useEffect, useRef, type RefObject} from 'react'

/** Outside presses must also work when portals and triggers share a ShadowRoot. */
export function useOverlayDismissal(
    open: boolean,
    trigger: RefObject<HTMLElement | null>,
    popover: RefObject<HTMLElement | null>,
    close: () => void,
) {
    const latest = useRef(close)
    const pressedWhileOpen = useRef(false)
    latest.current = close
    useEffect(() => {
        if (!open) return
        const document = trigger.current?.ownerDocument
        if (!document) return
        const outside = (event: PointerEvent) => {
            const path = event.composedPath()
            if (path.includes(trigger.current!) || path.includes(popover.current!)) return
            latest.current()
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !event.composedPath().includes(trigger.current!.getRootNode())) return
            event.preventDefault()
            event.stopPropagation()
            latest.current()
            trigger.current?.focus({preventScroll: true})
        }
        document.addEventListener('pointerdown', outside, true)
        document.addEventListener('keydown', escape, true)
        return () => {
            document.removeEventListener('pointerdown', outside, true)
            document.removeEventListener('keydown', escape, true)
        }
    }, [open, trigger, popover])
    return {
        onPointerDownCapture: () => {pressedWhileOpen.current = open},
        onKeyDownCapture: () => {pressedWhileOpen.current = false},
        onPress: () => {
            // Non-modal blur can close before React Aria processes the same trigger press.
            // Preserve that press's initial state instead of reopening the popover.
            if (pressedWhileOpen.current) latest.current()
            pressedWhileOpen.current = false
        },
    }
}
