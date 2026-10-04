import { useEffect, useState } from 'preact/hooks';

export interface ElementSize {
  readonly width: number;
  readonly height: number;
}

/** The size of an element's content box, tracked with a ResizeObserver. */
export function useSize(ref: { current: HTMLElement | null }): ElementSize | null {
  const [size, setSize] = useState<ElementSize | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
