import { useState } from 'react';
import {
  useAnnotation,
  useCommentThreads,
  useComments,
  useCommentsHydration,
  useStage,
  type AnnotationRef,
  type CommentThreadView,
} from '@embedpdf/react';
import { MessageSquareMore } from 'lucide-react';
import { Button, Dialog, PanelContent, PanelState } from '../components';
import styles from './comments.module.css';

type CommentMember = CommentThreadView['root'];

function refKey(ref: AnnotationRef) {
  if (ref.kind === 'objectNumber') return `object:${ref.annotObjectNumber}`;
  if (ref.kind === 'nm') return `nm:${ref.nm}`;
  return `index:${ref.pageObjectNumber}:${ref.index}`;
}

function CommentCard({
  member,
  onNavigate,
}: {
  member: CommentMember;
  onNavigate(): void;
}) {
  const comments = useComments();
  const permissions = comments.permissionsFor(member.ref);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(member.contents ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await comments.edit(member.ref, draft.trim());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return <li className={styles.item} data-editing={editing ? 'true' : undefined}>
    <button type="button" className={styles.cardTarget} aria-label="Show annotation" onClick={onNavigate} />
    <div className={styles.heading}>
      <span className={styles.icon}><MessageSquareMore size={15} /></span>
      <span className={styles.type}>{member.author || 'Comment'}</span>
    </div>
    {editing ? <div className={styles.editor}>
      <textarea className={styles.textarea} value={draft} autoFocus
        onChange={(event) => setDraft(event.currentTarget.value)} />
      <div className={styles.actions}>
        <Button onClick={() => { setDraft(member.contents ?? ''); setEditing(false); }}>Cancel</Button>
        <Button variant="primary" disabled={busy || !draft.trim()} onClick={() => void save()}>Save</Button>
      </div>
    </div> : <>
      <div className={`${styles.body} ${styles.readonlyBody}`}>{member.contents?.trim() || 'No comment text'}</div>
      {(permissions.canEditText || permissions.canDelete) ? <div className={styles.actions}>
        {permissions.canEditText ? <Button onClick={() => setEditing(true)}>Edit</Button> : null}
        {permissions.canDelete ? <Button onClick={() => void comments.remove(member.ref)}>Delete</Button> : null}
      </div> : null}
    </>}
  </li>;
}

function Thread({ thread }: { thread: CommentThreadView }) {
  const annotation = useAnnotation();
  const comments = useComments();
  const stage = useStage();
  const permissions = comments.permissionsFor(thread.root.ref);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const navigate = (ref: AnnotationRef) => {
    annotation.select(ref);
    if (thread.pageIndex >= 0 && thread.contentRect) {
      stage.reveal(thread.pageIndex, { rect: thread.contentRect });
    }
  };

  const submitReply = async () => {
    const text = reply.trim();
    if (!text) return;
    setBusy(true);
    try {
      await comments.reply(thread.root.ref, text);
      setReply('');
    } finally {
      setBusy(false);
    }
  };

  return <section className={styles.pageGroup}>
    <div className={styles.pageHeader}>Page {thread.pageLabel}</div>
    <ul className={styles.entries}>
      <CommentCard member={thread.root} onNavigate={() => navigate(thread.root.ref)} />
      {thread.replies.map((member) => <CommentCard
        key={refKey(member.ref)}
        member={member}
        onNavigate={() => navigate(member.ref)}
      />)}
    </ul>
    {permissions.canReply ? <div className={styles.editor}>
      <textarea className={styles.textarea} value={reply} placeholder="Reply…"
        onChange={(event) => setReply(event.currentTarget.value)} />
      <div className={styles.actions}>
        <Button variant="primary" disabled={busy || !reply.trim()} onClick={() => void submitReply()}>Reply</Button>
      </div>
    </div> : null}
  </section>;
}

export function Comments({ open, onClose }: { open: boolean; onClose(): void }) {
  // TODO(next.10): comments/review is new in next.10; keep its prerelease API contained here.
  const comments = useComments();
  const threads = useCommentThreads();
  const hydration = useCommentsHydration();

  let body;
  if (hydration.status === 'loading') body = <PanelState>Loading comments…</PanelState>;
  else if (hydration.status === 'error') body = <PanelState>
    Comments may be incomplete. <Button onClick={() => void comments.rehydrate()}>Retry</Button>
  </PanelState>;
  else if (hydration.status === 'forbidden') body = <PanelState>Comments are not permitted.</PanelState>;
  else if (!threads.length) body = <div className={styles.empty}>
    <span className={styles.emptyIcon}><MessageSquareMore size={24} /></span>
    <span className={styles.emptyTitle}>No comments</span>
    <span className={styles.emptyDescription}>Place a note or add text to an annotation to begin.</span>
  </div>;
  else body = <div className={styles.list}>{threads.map((thread) => (
    <Thread key={refKey(thread.root.ref)} thread={thread} />
  ))}</div>;

  return <Dialog open={open} onClose={onClose} title="Comments" variant="panel">
    <PanelContent className={styles.panel}>{body}</PanelContent>
  </Dialog>;
}
