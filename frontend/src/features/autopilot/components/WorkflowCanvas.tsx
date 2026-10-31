import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, Eye, FileText, Flag, Scale, User, Users, X } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { taskStatusColor } from '../workflowStyle';
import { buildWorkflow, type WorkflowNode } from '../workflow';
import type { Deliverable, Run } from '../types';
import { RequestCard } from './NeedsYou';

type NodeData = { item: WorkflowNode };
type FlowNode = Node<NodeData>;

const EXECUTOR_ICON = { ai: Bot, hybrid: Users, human: User } as const;

const hidden = { opacity: 0, width: 6, height: 6, border: 'none' };

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} style={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Right} style={hidden} isConnectable={false} />
    </>
  );
}

function TaskNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { t } = useTranslation('autopilot');
  if (data.item.kind !== 'task') return null;
  const { task, request } = data.item;
  const Icon = EXECUTOR_ICON[task.routing.executor];
  const color = taskStatusColor(task.status);
  const live = task.status === 'working' || task.status === 'review';
  const muted = task.status === 'cancelled' || task.status === 'failed';
  return (
    <div
      className={`w-[240px] rounded-2xl bg-(--ap-surface) p-3 shadow-sm transition-shadow ${muted ? 'opacity-50' : ''}`}
      style={{ border: `${selected ? 2 : 1.5}px ${task.origin === 'scope_change' ? 'dashed' : 'solid'} ${color}`, boxShadow: live ? `0 0 0 4px color-mix(in srgb, ${color} 25%, transparent)` : undefined }}
    >
      <Handles />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] text-(--ap-muted)">
          <Icon className="w-3.5 h-3.5" aria-hidden />
          {t(`executor.${task.routing.executor}`)}
        </span>
        {task.origin === 'scope_change' && <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ background: 'var(--ap-hybrid)' }}>{t('workflow.added')}</span>}
      </div>
      <p className={`mt-1.5 text-[13px] font-semibold leading-snug line-clamp-2 ${muted ? 'line-through' : ''}`} dir="auto">
        {task.title}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1.5" style={{ color }}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? 'ap-live' : ''}`} style={{ background: color }} aria-hidden />
          {t(`taskStatus.${task.status}`)}
          {task.attempts > 1 && live ? ` · ${t('workflow.attempt', { attempt: task.attempts })}` : ''}
        </span>
        {request && <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-(--ap-accent-ink)" style={{ background: 'var(--ap-accent)' }}>{t('workflow.needsPerson')}</span>}
      </div>
    </div>
  );
}

function ObjectiveNodeView({ data }: NodeProps<FlowNode>) {
  const { t } = useTranslation('autopilot');
  if (data.item.kind !== 'objective') return null;
  return (
    <div className="w-[220px] rounded-2xl p-3 text-(--ap-accent-ink)" style={{ background: 'var(--ap-accent)' }}>
      <Handles />
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide opacity-90">
        <Flag className="w-3.5 h-3.5" aria-hidden /> {t('workflow.objective')}
      </p>
      <p className="mt-1 text-[13px] font-semibold leading-snug line-clamp-3" dir="auto">
        {data.item.title}
      </p>
    </div>
  );
}

function DecisionNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { t } = useTranslation('autopilot');
  if (data.item.kind !== 'decision') return null;
  return (
    <div className="w-[230px] rounded-2xl bg-(--ap-surface) p-3" style={{ border: `${selected ? 2 : 1.5}px solid var(--ap-accent)` }}>
      <Handles />
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--ap-accent)">
        <Scale className="w-3.5 h-3.5" aria-hidden /> {t('workflow.decision')}
      </p>
      <p className="mt-1 text-[13px] font-semibold leading-snug line-clamp-2" dir="auto">
        {data.item.request.title}
      </p>
    </div>
  );
}

function ReportNodeView({ data }: NodeProps<FlowNode>) {
  const { t } = useTranslation('autopilot');
  if (data.item.kind !== 'report') return null;
  const color = data.item.done ? 'var(--ap-good)' : 'var(--ap-border)';
  return (
    <div className="w-[200px] rounded-2xl bg-(--ap-surface) p-3" style={{ border: `1.5px solid ${color}` }}>
      <Handles />
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        <FileText className="w-4 h-4" aria-hidden style={{ color }} /> {t('workflow.report')}
      </p>
      <p className="mt-1 text-[11px] text-(--ap-muted)">{data.item.done ? t('workflow.reportDone') : t('workflow.reportPending')}</p>
    </div>
  );
}

const nodeTypes = { objective: ObjectiveNodeView, task: TaskNodeView, decision: DecisionNodeView, report: ReportNodeView };

/** Refits the view when steps are added, so a scope change visibly grows the workflow. */
function FitOnGrowth({ count }: { count: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = window.setTimeout(() => void fitView({ padding: 0.15, duration: 400 }), 50);
    return () => window.clearTimeout(timer);
  }, [count, fitView]);
  return null;
}

interface WorkflowCanvasProps {
  run: Run;
  onAnswer: (requestId: string, response: string) => Promise<void>;
  onView: (deliverable: Deliverable) => void;
  readOnly: boolean;
}

/** The run as a live workflow: agents light up on their steps, people approve on the node, client changes add steps. */
export function WorkflowCanvas({ run, onAnswer, onView, readOnly }: WorkflowCanvasProps) {
  const { t } = useTranslation('autopilot');
  const { theme } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { nodes: items, edges: links } = useMemo(() => buildWorkflow(run), [run]);

  const nodes: FlowNode[] = items.map((item) => ({ id: item.id, type: item.kind, position: { x: item.x, y: item.y }, data: { item }, selected: item.id === selectedId, draggable: false, connectable: false }));
  const edges: Edge[] = links.map((link) => ({
    id: link.id,
    source: link.source,
    target: link.target,
    type: 'smoothstep',
    animated: link.active,
    style: { stroke: link.active ? 'var(--ap-accent)' : link.done ? 'var(--ap-good)' : 'var(--ap-border)', strokeWidth: link.active ? 2.5 : 1.5 },
  }));
  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <section aria-labelledby="ap-workflow" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ap-workflow" className="ap-display text-[21px]">
          {t('workflow.title')}
        </h2>
        <p className="text-[13px] text-(--ap-muted)">{t('workflow.hint')}</p>
      </div>
      <div className="ap-card relative h-[460px] overflow-hidden" dir="ltr">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            colorMode={theme}
            fitView
            minZoom={0.3}
            maxZoom={1.5}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={(_, node) => setSelectedId(node.id === 'objective' || node.id === 'report' ? null : node.id)}
            onPaneClick={() => setSelectedId(null)}
            style={{ background: 'transparent' }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <FitOnGrowth count={items.length} />
          </ReactFlow>
        </ReactFlowProvider>
        {selected && (selected.kind === 'task' || selected.kind === 'decision') && (
          <StepPanel item={selected} onClose={() => setSelectedId(null)} onAnswer={onAnswer} onView={onView} readOnly={readOnly} />
        )}
      </div>
    </section>
  );
}

interface StepPanelProps {
  item: Extract<WorkflowNode, { kind: 'task' | 'decision' }>;
  onClose: () => void;
  onAnswer: WorkflowCanvasProps['onAnswer'];
  onView: WorkflowCanvasProps['onView'];
  readOnly: boolean;
}

function StepPanel({ item, onClose, onAnswer, onView, readOnly }: StepPanelProps) {
  const { t } = useTranslation('autopilot');
  const task = item.kind === 'task' ? item.task : null;
  const request = item.request;
  const draft = item.kind === 'task' ? item.draft : null;

  return (
    <aside className="absolute inset-y-3 end-3 w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-2xl bg-(--ap-surface) p-4 shadow-xl border border-(--ap-border)" dir="auto" aria-label={task?.title ?? request?.title}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[16px] font-semibold leading-snug">{task?.title ?? request?.title}</h3>
        <button type="button" onClick={onClose} aria-label={t('workflow.close')} className="p-1 rounded-full hover:bg-(--ap-surface-2)">
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>
      {task && (
        <div className="mt-3 space-y-3 text-[13px]">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-(--ap-muted)">
            <span style={{ color: taskStatusColor(task.status) }}>{t(`taskStatus.${task.status}`)}</span>
            <span>· {t(`executor.${task.routing.executor}`)}</span>
            {task.assignee && <span>· {t('workflow.owner', { name: task.assignee })}</span>}
          </p>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-(--ap-muted)">{t('workflow.why')}</p>
            <p className="mt-0.5">{task.routing.rationale}</p>
          </div>
          {task.acceptanceCriteria.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-(--ap-muted)">{t('workflow.criteria')}</p>
              <ul className="mt-0.5 list-disc ps-4 space-y-0.5">
                {task.acceptanceCriteria.slice(0, 3).map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
            </div>
          )}
          {draft && (
            <button type="button" onClick={() => onView(draft)} className="inline-flex items-center gap-1.5 text-(--ap-link)">
              <Eye className="w-4 h-4" aria-hidden /> {t('needsYou.viewDraft', { attempt: draft.attempt })}
            </button>
          )}
        </div>
      )}
      {request && (
        <div className="mt-4">
          <RequestCard request={request} draft={undefined} onAnswer={onAnswer} onView={onView} readOnly={readOnly} />
        </div>
      )}
    </aside>
  );
}
