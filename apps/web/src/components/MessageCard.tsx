import { useState } from 'react';
import type { MeshMessage, MeshApproveParams } from '@workbench/contracts';
import type { ShellProjection } from '@workbench/contracts';
import { call } from '../store';
import { fmtTime, partyName } from '../util';

const STATUS_TAG: Record<MeshMessage['status'], { cls: string; label: string }> = {
  injected: { cls: 'ok', label: '已送达' },
  held: { cls: 'hold', label: '待放行' },
  queued: { cls: 'queued', label: '队列中' },
  denied: { cls: 'denied', label: '已驳回' },
};

/** 待放行消息的 放行/编辑/驳回 按钮组（含内联编辑态） */
export function HeldActions({ message }: { message: MeshMessage }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);

  const approve = (editedBody?: string) => {
    const params: MeshApproveParams = { messageId: message.id, editedBody };
    void call('mesh.approve', params);
  };
  const deny = () => {
    void call('mesh.deny', { messageId: message.id });
  };

  if (editing) {
    return (
      <div>
        <textarea
          className="edit-area"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <div className="actions">
          <button className="btn pri" onClick={() => approve(draft)}>
            确认放行
          </button>
          <button className="btn" onClick={() => setEditing(false)}>
            取消
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="actions">
      <button className="btn pri" onClick={() => approve()}>
        放行并注入
      </button>
      <button className="btn" onClick={() => setEditing(true)}>
        编辑后放行
      </button>
      <button className="btn warn" onClick={deny}>
        驳回
      </button>
    </div>
  );
}

export function MessageCard({
  message,
  projection,
}: {
  message: MeshMessage;
  projection: ShellProjection | null;
}) {
  const tag = STATUS_TAG[message.status];
  return (
    <div className="msg">
      <div className="hd">
        <b>{partyName(projection, message.from)}</b> → <b>{partyName(projection, message.to)}</b>
        <span className={`tag ${tag.cls}`}>{tag.label}</span>
        <span className="t">{fmtTime(message.createdAt)}</span>
      </div>
      <div className="bd">{message.body}</div>
      {message.attachment && (
        <span className="attach">
          ⎘ {message.attachment.label}
          {message.attachment.diffStat ? ` · ${message.attachment.diffStat}` : ''}
        </span>
      )}
      {message.status === 'held' && <HeldActions message={message} />}
    </div>
  );
}
