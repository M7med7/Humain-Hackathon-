import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Eye, Pause, Play, Sparkles, X } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { runAtEvent } from '../replay';
import { taskStatusColor } from '../workflowStyle';
import { buildWorkflow, OBJECTIVE_ID, REPORT_ID, type WorkflowNode } from '../workflow';
import type { Deliverable, Run } from '../types';
import { RequestCard } from './NeedsYou';
import { WorkflowChat } from './WorkflowChat';
import { DecisionNodeView, ObjectiveNodeView, ReportNodeView, TaskNodeView, type FlowNode } from './WorkflowNodes';

const nodeTypes = { objective: ObjectiveNodeView, task: TaskNodeView, decision: DecisionNodeView, report: ReportNodeView };

/** Opens the conversation about the whole workflow instead of one step. */
const WORKFLOW_PANEL = 'workflow';
const REPLAY_STEP_MS = 350;


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
  onChange: (instruction: string, taskId: string | null) => Promise<void>;
  onRemove: (taskId: string) => Promise<void>;
  readOnly: boolean;
}

/**
 * The run as a live workflow: boxes appear as the plan is made, agents light up on their
 * steps, people approve or change a step on its box, and a replay plays a finished run back.
 */
export function WorkflowCanvas({ run, onAnswer, onView, onChange, onRemove, readOnly }: WorkflowCanvasProps) {
  const { t } = useTranslation('autopilot');
  const { theme } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const replaying = replayAt !== null;
  const lastEvent = run.events.length - 1;

  useEffect(() => {
    if (!playing || replayAt === null) return;
    const timer = window.setTimeout(() => {
      const next = Math.min(replayAt + 1, lastEvent);
      setReplayAt(next);
      if (next >= lastEvent) setPlaying(false);
    }, REPLAY_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, replayAt, lastEvent]);

  const shown = useMemo(() => (replayAt === null ? run : runAtEvent(run, replayAt)), [run, replayAt]);
  const { nodes: items, edges: links } = useMemo(() => buildWorkflow(shown), [shown]);

  const nodes: FlowNode[] = items.map((item) => ({ id: item.id, type: item.kind, position: { x: item.x, y: item.y }, data: { item }, selected: item.id === selectedId, draggable: false, connectable: false }));
  // Curved links: moving dashes where work is flowing, solid once the source is done, dashed while waiting.
  const edges: Edge[] = links.map((link) => ({
    id: link.id,
    source: link.source,
    target: link.target,
    animated: link.active,
    style: {
      stroke: link.active ? 'var(--ap-accent)' : link.done ? 'var(--ap-good)' : 'var(--ap-muted)',
      strokeWidth: link.active ? 2.5 : 1.75,
      strokeDasharray: link.active || link.done ? undefined : '5 6',
      opacity: link.active || link.done ? 1 : 0.6,
    },
  }));
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const changeable = !readOnly && run.status !== 'planning' && run.status !== 'stopped';
  const caption = replayAt === null ? null : run.events[replayAt];

  const startReplay = (): void => {
    setSelectedId(null);
    setReplayAt(0);
    setPlaying(true);
  };
  const stopReplay = (): void => {
    setPlaying(false);
    setReplayAt(null);
  };

  return (
    <section aria-labelledby="ap-workflow" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="ap-workflow" className="ap-display text-[21px]">
            {t('workflow.title')}
          </h2>
          <p className="text-[13px] text-(--ap-muted)">{changeable ? t('workflow.hintEditable') : t('workflow.hint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {changeable && !replaying && (
            <button type="button" onClick={() => setSelectedId(WORKFLOW_PANEL)} className="ap-pill ap-pill-primary inline-flex items-center gap-1.5 text-[13px] px-3.5 py-1.5">
              <Sparkles className="w-4 h-4" aria-hidden /> {t('workflow.change')}
            </button>
          )}
          {run.events.length > 1 && run.tasks.length > 0 && (
            <button type="button" onClick={replaying ? stopReplay : startReplay} className="ap-pill inline-flex items-center gap-1.5 border border-(--ap-border) text-[13px] px-3.5 py-1.5">
              {replaying ? <X className="w-4 h-4" aria-hidden /> : <Play className="w-4 h-4 rtl:-scale-x-100" aria-hidden />}
              {replaying ? t('workflow.replay.stop') : t('workflow.replay.start')}
            </button>
          )}
        </div>
      </div>
      <div className="ap-card ap-flow relative h-[520px] overflow-hidden" dir="ltr">
        <ReactFlowProvider key={replaying ? 'replay' : 'live'}>
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
            onNodeClick={(_, node) => {
              if (!replaying) setSelectedId(node.id === OBJECTIVE_ID || node.id === REPORT_ID ? null : node.id);
            }}
            onPaneClick={() => setSelectedId(null)}
            style={{ background: 'transparent' }}
          >
            <Background gap={20} size={1} bgColor="transparent" />
            <Controls showInteractive={false} position="bottom-left" />
            <FitOnGrowth count={items.length} />
          </ReactFlow>
        </ReactFlowProvider>
        {shown.status === 'planning' && shown.tasks.length === 0 && (
          <p className="ap-live pointer-events-none absolute inset-x-0 top-[60%] text-center text-[14px] text-(--ap-muted)" dir="auto">
            {t('workflow.planning')}
          </p>
        )}
        {caption && (
          <div className="absolute inset-x-3 bottom-3 ms-12 flex items-center gap-3 rounded-2xl border border-(--ap-border) bg-(--ap-surface) p-3 shadow-lg" dir="auto">
            <button type="button" onClick={() => (replayAt !== null && replayAt >= lastEvent ? startReplay() : setPlaying(!playing))} aria-label={playing ? t('workflow.replay.pause') : t('workflow.replay.play')} className="ap-pill ap-pill-primary p-2">
              {playing ? <Pause className="w-4 h-4" aria-hidden /> : <Play className="w-4 h-4 rtl:-scale-x-100" aria-hidden />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-(--ap-muted)">
                {t('workflow.replay.progress', { current: (replayAt ?? 0) + 1, total: run.events.length })} · {actorLabel(caption.actor, t)}
              </p>
              <p className="truncate text-[13px]" title={caption.summary}>
                {caption.summary}
              </p>
            </div>
          </div>
        )}
        {selectedId === WORKFLOW_PANEL && (
          <aside className="absolute inset-y-3 end-3 w-[min(24rem,calc(100%-1.5rem))] overflow-y-auto rounded-2xl bg-(--ap-surface) p-4 shadow-xl border border-(--ap-border)" dir="auto" aria-label={t('workflow.change')}>
            <PanelHeader title={t('workflow.change')} onClose={() => setSelectedId(null)} />
            <p className="mt-2 text-[13px] text-(--ap-muted)">{t('workflow.changeHint')}</p>
            <WorkflowChat run={run} taskId={null} readOnly={readOnly} onChange={onChange} onRemove={onRemove} />
          </aside>
        )}
        {selected && (selected.kind === 'task' || selected.kind === 'decision') && (
          <StepPanel item={selected} run={run} onClose={() => setSelectedId(null)} onAnswer={onAnswer} onView={onView} onChange={onChange} onRemove={onRemove} readOnly={readOnly} />
        )}
      </div>
    </section>
  );
}

/** Who did something, for the replay caption: an agent role, the client, the scheduler or a person's name. */
function actorLabel(actor: string, t: TFunction<'autopilot'>): string {
  if (actor.startsWith('person:')) return actor.slice('person:'.length);
  if (actor === 'client' || actor === 'scheduler') return t(`workflow.replay.${actor}`);
  return t(`agents.names.${actor.replace('agent:', '')}`);
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useTranslation('autopilot');
  return (
    <div className="flex items-start justify-between gap-2">
      <h3 className="text-[16px] font-semibold leading-snug">{title}</h3>
      <button type="button" onClick={onClose} aria-label={t('workflow.close')} className="p-1 rounded-full hover:bg-(--ap-surface-2)">
        <X className="w-4 h-4" aria-hidden />
      </button>
    </div>
  );
}

interface StepPanelProps {
  item: Extract<WorkflowNode, { kind: 'task' | 'decision' }>;
  run: Run;
  onClose: () => void;
  onAnswer: WorkflowCanvasProps['onAnswer'];
  onView: WorkflowCanvasProps['onView'];
  onChange: WorkflowCanvasProps['onChange'];
  onRemove: WorkflowCanvasProps['onRemove'];
  readOnly: boolean;
}

function StepPanel({ item, run, onClose, onAnswer, onView, onChange, onRemove, readOnly }: StepPanelProps) {
  const { t } = useTranslation('autopilot');
  const task = item.kind === 'task' ? item.task : null;
  const request = item.request;
  const draft = item.kind === 'task' ? item.draft : null;

  return (
    <aside className="absolute inset-y-3 end-3 w-[min(24rem,calc(100%-1.5rem))] overflow-y-auto rounded-2xl bg-(--ap-surface) p-4 shadow-xl border border-(--ap-border)" dir="auto" aria-label={task?.title ?? request?.title}>
      <PanelHeader title={task?.title ?? request?.title ?? ''} onClose={onClose} />
      {task && (
        <div className="mt-3 space-y-3 text-[13px]">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-(--ap-muted)">
            <span style={{ color: taskStatusColor(task.status) }}>{t(`taskStatus.${task.status}`)}</span>
            <span>· {t(`executor.${task.routing.executor}`)}</span>
            {task.assignee && <span>· {t('workflow.owner', { name: task.assignee })}</span>}
          </p>
          <p>{task.description}</p>
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
      {task && <WorkflowChat run={run} taskId={task.id} readOnly={readOnly} onChange={onChange} onRemove={onRemove} />}
    </aside>
  );
}
