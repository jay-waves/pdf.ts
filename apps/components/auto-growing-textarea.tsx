import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react';

type SizingOptions = {
  minHeight?: number;
  maxHeight?: number;
  viewportFraction?: number;
  reset?: boolean;
};

/** Resize the enclosing flex popover, leaving the textarea free to fill it
 * after a manual resize. Automatic growth never shrinks a user's larger size. */
export function sizeTextareaPopover(input: HTMLTextAreaElement, {
  minHeight = 144,
  maxHeight = 420,
  viewportFraction = 0.6,
  reset = false,
}: SizingOptions = {}) {
  const panel = input.parentElement;
  if (!panel) return;
  if (reset) {
    panel.style.removeProperty('height');
    input.style.height = `${minHeight}px`;
  }
  const currentHeight = input.getBoundingClientRect().height;
  const height = Math.min(Math.max(minHeight, input.scrollHeight), maxHeight, window.innerHeight * viewportFraction);
  if (reset || height > currentHeight) {
    panel.style.height = `${panel.getBoundingClientRect().height + height - currentHeight}px`;
  }
  if (reset) input.style.removeProperty('height');
}

type Props = ComponentPropsWithoutRef<'textarea'> & {
  autoGrow?: boolean;
  maxAutoHeight?: number;
  viewportFraction?: number;
};

export const AutoGrowingTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoGrowingTextarea({
  autoGrow = true, maxAutoHeight = 420, viewportFraction = 0.6, value, ...props
}, ref) {
  const input = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => input.current!, []);

  useLayoutEffect(() => {
    if (autoGrow && input.current) sizeTextareaPopover(input.current, { maxHeight: maxAutoHeight, viewportFraction });
  }, [autoGrow, maxAutoHeight, viewportFraction, value]);

  useLayoutEffect(() => {
    const element = input.current;
    if (!autoGrow || !element) return;
    const grow = () => sizeTextareaPopover(element, { maxHeight: maxAutoHeight, viewportFraction });
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      grow();
    });
    observer.observe(element);
    window.addEventListener('resize', grow);
    return () => { observer.disconnect(); window.removeEventListener('resize', grow); };
  }, [autoGrow, maxAutoHeight, viewportFraction]);

  return <textarea {...props} ref={input} value={value} />;
});
