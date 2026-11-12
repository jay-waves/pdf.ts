import { useEffect, useRef, useState } from 'react';
import { useOutline, useOutlineState } from '@embedpdf/react/outline';
import { usePageList } from '@embedpdf/react/runtime';
import { PanelContent, PanelState } from '../components';
import styles from './outline.module.css';

/** The v3 plugin owns loading, hierarchy, expansion, selection and PDF actions. */
export function Outline() {
  const outline = useOutline();
  const { status, rows, current, selected, incomplete } = useOutlineState();
  const pages = usePageList();
  const contentRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const active = selected[0] ?? current;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const root = contentRef.current;
      const item = root?.querySelector<HTMLElement>('[data-current="true"]');
      if (!root || !item) return;
      root.scrollTo({ top: Math.max(0, root.scrollTop + item.getBoundingClientRect().top
        - root.getBoundingClientRect().top - root.clientHeight / 2 + item.offsetHeight / 2), behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [active?.objectNumber, status]);

  const retry = () => {
    setError('');
    void outline.refresh().catch(failure => setError(failure instanceof Error ? failure.message : 'Failed to load the outline.'));
  };

  return <PanelContent ref={contentRef}>
    {status === 'idle' || status === 'loading' ? <PanelState>Loading outline...</PanelState> : null}
    {status === 'forbidden' ? <PanelState>This document does not allow reading its outline.</PanelState> : null}
    {status === 'error' ? <PanelState>Failed to load the outline. <button type="button" onClick={retry}>Retry</button></PanelState> : null}
    {status === 'ready' && !rows.length ? <PanelState>This PDF does not include an outline.</PanelState> : null}
    {incomplete ? <p role="status">Some outline entries could not be read.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <ol className={styles.list}>
      {rows.map(({ item, depth, hasChildren, expanded }) => {
        const destination = item.target?.kind === 'goto' ? item.target.destination : null;
        const pageIndex = destination ? pages.findIndex(page => page.ref.objectNumber === destination.page.objectNumber) : -1;
        const isCurrent = active?.objectNumber === item.ref.objectNumber;
        return <li key={item.ref.objectNumber}>
          <button type="button" className={styles.bookmark} data-outline-bookmark
            data-current={isCurrent ? 'true' : undefined}
            aria-expanded={hasChildren ? expanded : undefined}
            style={{ marginLeft: depth * 18, width: `calc(100% - ${depth * 18}px)` }}
            disabled={!hasChildren && !item.target && !item.action}
            onClick={() => {
              setError('');
              if (hasChildren && (!expanded || isCurrent)) { outline.toggle(item.ref); return; }
              outline.select([item.ref]);
              try { outline.activate(item.ref); }
              catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not open this outline entry.'); }
            }}>
            <span className={styles.title}>{item.title || 'Untitled'}</span>
            {pageIndex >= 0 ? <span className={styles.page}>{pages[pageIndex]?.label ?? pageIndex + 1}</span> : null}
          </button>
        </li>;
      })}
    </ol>
  </PanelContent>;
}
