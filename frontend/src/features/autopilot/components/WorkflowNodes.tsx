import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Bot, CircleCheck, FileText, Flag, Scale, User, Users } from 'lucide-react';
import { taskStatusColor } from '../workflowStyle';
import { COLUMN_WIDTH, type WorkflowNode } from '../workflow';

export type FlowNode = Node<{ item: WorkflowNode }>;

const NODE_STAGGER_MS = 110;
const EXECUTOR_ICON = { ai: Bot, hybrid: Users, human: User } as const;

/** Boxes appear column by column, so a new plan visibly builds from the objective outwards. */
const appear = (item: WorkflowNode): CSSProperties => ({ animationDelay: `${Math.round((item.x / COLUMN_WIDTH) * NODE_STAGGER_MS)}ms` });

interface ShellProps {
  item: WorkflowNode;
  width: number;
  header: ReactNode;
  /** Border and glow color; the step's status for tasks. */
  color: string;
  selected?: boolean;
  dashed?: boolean;
  glow?: boolean;
  dimmed?: boolean;
  inputs?: boolean;
  outputs?: boolean;
  children: ReactNode;
}

/** A box with a header bar and a body, connected on the left (inputs) and right (outputs). */
function Shell({ item, width, header, color, selected = false, dashed = false, glow = false, dimmed = false, inputs = true, outputs = true, children }: ShellProps) {
  const border = selected ? 'var(--ap-accent)' : `color-mix(in srgb, ${color} 60%, var(--ap-border))`;
  return (
    <div
      className={`ap-node-in rounded-xl bg-(--ap-surface) shadow-[0_10px_30px_-14px_rgba(0,0,0,0.55)] ${dimmed ? 'opacity-50' : ''}`}
      style={{
        ...appear(item),
        width,
        border: `${selected ? 2 : 1.5}px ${dashed ? 'dashed' : 'solid'} ${border}`,
        boxShadow: glow ? `0 0 0 4px color-mix(in srgb, ${color} 22%, transparent), 0 10px 30px -14px rgba(0,0,0,0.55)` : undefined,
      }}
    >
      {inputs && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <div className="flex items-center justify-between gap-2 border-b border-(--ap-border) px-3 py-2 text-[11px] font-semibold">{header}</div>
      <div className="px-3 py-2.5">{children}</div>
      {outputs && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </div>
  );
}

export function TaskNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { t } = useTranslation('autopilot');
  if (data.item.kind !== 'task') return null;
  const { task, request } = data.item;
  const Icon = EXECUTOR_ICON[task.routing.executor];
  const color = taskStatusColor(task.status);
  const live = task.status === 'working' || task.status === 'review';
  const removed = task.status === 'cancelled' || task.status === 'failed';
  const header = (
    <>
      <span className="flex items-center gap-1.5 text-(--ap-muted)">
        <Icon className="w-3.5 h-3.5" aria-hidden /> {t(`executor.${task.routing.executor}`)}
      </span>
      <span className="flex items-center gap-1.5">
        {task.origin === 'scope_change' && (
          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ background: 'var(--ap-hybrid)' }}>
            {t('workflow.added')}
          </span>
        )}
        <span className={`inline-block h-2 w-2 rounded-full ${live ? 'ap-live' : ''}`} style={{ background: color }} aria-hidden />
      </span>
    </>
  );
  return (
    <Shell item={data.item} width={240} header={header} color={color} selected={selected} dashed={task.origin === 'scope_change'} glow={live} dimmed={removed}>
      <p className={`text-[13px] font-semibold leading-snug line-clamp-2 ${removed ? 'line-through' : ''}`} dir="auto">
        {task.title}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span style={{ color }}>
          {t(`taskStatus.${task.status}`)}
          {task.attempts > 1 && live ? ` · ${t('workflow.attempt', { attempt: task.attempts })}` : ''}
        </span>
        {request && (
          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-(--ap-accent-ink)" style={{ background: 'var(--ap-accent)' }}>
            {t('workflow.needsPerson')}
          </span>
        )}
      </div>
      {live && <div className="ap-progress mt-2" aria-hidden />}
    </Shell>
  );
}

export function ObjectiveNodeView({ data }: NodeProps<FlowNode>) {
  const { t } = useTranslation('autopilot');
  if (data.item.kind !== 'objective') return null;
  const header = (
    <span className="flex items-center gap-1.5 text-(--ap-accent)">
      <Flag className="w-3.5 h-3.5" aria-hidden /> {t('workflow.objective')}
    </span>
  );
  return (
    <Shell item={data.item} width={220} header={header} color="var(--ap-accent)" glow inputs={false}>
      <p className="text-[13px] font-semibold leading-snug line-clamp-3" dir="auto">
        {data.item.title}
      </p>
    </Shell>
  );
}

export function DecisionNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { t } = useTranslation('autopilot');
  if (data.item.kind !== 'decision') return null;
  const header = (
    <span className="flex items-center gap-1.5 text-(--ap-accent)">
      <Scale className="w-3.5 h-3.5" aria-hidden /> {t('workflow.decision')}
    </span>
  );
  return (
    <Shell item={data.item} width={230} header={header} color="var(--ap-accent)" selected={selected} glow inputs={false}>
      <p className="text-[13px] font-semibold leading-snug line-clamp-2" dir="auto">
        {data.item.request.title}
      </p>
    </Shell>
  );
}

/** The output of the workflow: fills up as steps finish and turns green when the report is delivered. */
export function ReportNodeView({ data }: NodeProps<FlowNode>) {
  const { t } = useTranslation('autopilot');
  if (data.item.kind !== 'report') return null;
  const { done, finished, total } = data.item;
  const color = done ? 'var(--ap-good)' : 'var(--ap-accent)';
  const share = total === 0 ? 0 : Math.round((finished / total) * 100);
  const header = (
    <span className="flex items-center gap-1.5">
      <FileText className="w-3.5 h-3.5" aria-hidden style={{ color }} /> {t('workflow.report')}
    </span>
  );
  return (
    <Shell item={data.item} width={250} header={header} color={done ? 'var(--ap-good)' : 'var(--ap-border)'} glow={done} outputs={false}>
      {done ? (
        <p className="flex items-center gap-1.5 text-[14px] font-semibold" style={{ color }}>
          <CircleCheck className="w-4 h-4" aria-hidden /> {t('workflow.reportDone')}
        </p>
      ) : (
        <p className="text-[12px] text-(--ap-muted)">{t('workflow.reportPending')}</p>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--ap-surface-2)" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished} aria-label={t('workflow.reportProgress', { finished, total })}>
          <div className="h-full origin-left rounded-full transition-transform duration-700" style={{ transform: `scaleX(${share / 100})`, background: color }} />
        </div>
        <span className="text-[11px] tabular-nums text-(--ap-muted)">{t('workflow.reportProgress', { finished, total })}</span>
      </div>
    </Shell>
  );
}
