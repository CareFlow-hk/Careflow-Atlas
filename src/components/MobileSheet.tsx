import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { moveSheetSnap, nextSheetSnap, resolveSheetSnap, type MobileSheetSnap } from './mobileSheetState';

interface MobileSheetProps {
  snap: MobileSheetSnap;
  onSnapChange: (snap: MobileSheetSnap) => void;
  title: string;
  hasSelection: boolean;
  list: ReactNode;
  detail?: ReactNode;
  editor?: ReactNode;
  toast?: ReactNode;
}

/**
 * One map companion, not several competing drawers. All three panes stay mounted so changing
 * height or temporarily hiding the editor cannot throw away a draft or a list's scroll offset.
 */
export function MobileSheet({ snap, onSnapChange, title, hasSelection, list, detail, editor, toast }: MobileSheetProps) {
  const gesture = useRef({ id: -1, startY: 0, lastY: 0, time: 0, snap, moved: false });
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const activePane = snap === 'expanded' && editor ? 'editor' : hasSelection ? 'detail' : 'list';
  const editing = Boolean(editor);

  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    gesture.current = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, time: performance.now(), snap, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (gesture.current.id !== event.pointerId) return;
    const delta = event.clientY - gesture.current.startY;
    if (Math.abs(delta) > 6) gesture.current.moved = true;
    gesture.current.lastY = event.clientY;
    setDragOffset(delta);
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    if (gesture.current.id !== event.pointerId) return;
    const current = gesture.current;
    const delta = event.clientY - current.startY;
    const elapsed = Math.max(1, performance.now() - current.time);
    const velocity = (event.clientY - current.lastY) / Math.max(1, performance.now() - current.time);
    if (!cancelled) onSnapChange(resolveSheetSnap(current.snap, delta, velocity || delta / elapsed));
    gesture.current.id = -1;
    setDragOffset(0);
    setDragging(false);
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    onSnapChange(moveSheetSnap(snap, event.key === 'ArrowUp' ? 1 : -1));
  };
  const style: CSSProperties = { '--sheet-drag-y': `${dragOffset}px` } as CSSProperties;
  const actionLabel = snap === 'expanded' ? '收起到半屏' : snap === 'half' ? '展開記錄面板' : editing ? '返回未保存的記錄' : hasSelection ? '展開大廈詳情' : '展開大廈清單';

  return <section className={`cf-mobile-sheet is-${snap}${dragging ? ' is-dragging' : ''}`} style={style} aria-label="手機工作面板">
    <button
      type="button"
      className="cf-mobile-sheet__handle"
      aria-expanded={snap !== 'collapsed'}
      aria-controls="cf-mobile-sheet-panes"
      aria-label={actionLabel}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={event => finish(event)}
      onPointerCancel={event => finish(event, true)}
      onKeyDown={keyDown}
      onClick={() => {
        if (gesture.current.moved) { gesture.current.moved = false; return; }
        onSnapChange(nextSheetSnap(snap, editing));
      }}
    >
      <span className="cf-mobile-sheet__grip" aria-hidden="true" />
      <span className="cf-mobile-sheet__title"><strong>{title}</strong><small>{editing && snap === 'collapsed' ? '草稿保留在這部裝置' : snap === 'collapsed' ? '點按或向上滑動' : '上下滑動調整面板'}</small></span>
      {snap === 'expanded' ? <ChevronDown size={20} aria-hidden="true" /> : <ChevronUp size={20} aria-hidden="true" />}
    </button>
    {toast && <div className="cf-mobile-sheet__notice">{toast}</div>}
    <div className="cf-mobile-sheet__panes" id="cf-mobile-sheet-panes">
      <div className="cf-mobile-sheet__pane" hidden={activePane !== 'list'}>{list}</div>
      <div className="cf-mobile-sheet__pane" hidden={activePane !== 'detail'}>{detail}</div>
      <div className="cf-mobile-sheet__pane cf-mobile-sheet__pane--editor" hidden={activePane !== 'editor'}>{editor}</div>
    </div>
  </section>;
}
