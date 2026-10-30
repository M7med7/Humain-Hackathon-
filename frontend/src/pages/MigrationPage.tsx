import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload, Download, ArrowRight, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Loader2, X, Sparkles, FileText,
  AlertCircle, Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { api, authHeaders, type ImportRow, type ImportAnalysis, type ImportAnalysisFinding, type Project } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { useTranslation } from "react-i18next";

type Tab = "export" | "import";
type ExportFormat = "jira" | "linear";
type ImportSource = "jira" | "linear";

const PRIORITY_COLORS: Record<string, string> = {
  High: "text-red-400 bg-red-500/10 border-red-500/20",
  Medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  Low: "text-green-400 bg-green-500/10 border-green-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  Backlog: "text-gray-400 app-surface-soft border-white/10",
  "To Do": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "In Progress": "text-purple-400 bg-purple-500/10 border-purple-500/20",
  "In Review": "text-orange-400 bg-orange-500/10 border-orange-500/20",
  Done: "text-green-400 bg-green-500/10 border-green-500/20",
};

const SEVERITY_COLORS: Record<string, string> = {
  high: "border-red-500/30 bg-red-900/10",
  medium: "border-yellow-500/30 bg-yellow-900/10",
  low: "border-blue-500/30 bg-blue-900/10",
};

const SEVERITY_ICON_COLORS: Record<string, string> = {
  high: "text-red-400",
  medium: "text-yellow-400",
  low: "text-blue-400",
};

function Badge({ text, colorClass }: { text: string; colorClass: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-medium ${colorClass}`}>
      {text}
    </span>
  );
}

function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/10 app-surface-soft p-6 ${className}`}>
      {children}
    </div>
  );
}

function FormatButton({
  selected, onSelect, label, description,
}: {
  format: string; selected: boolean; onSelect: () => void; label: string; description: string;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex flex-col gap-1 rounded-xl border px-5 py-4 text-left transition-all ${selected
        ? "border-purple-500/60 bg-purple-500/10 text-purple-200"
        : "border-white/10 app-surface-soft text-gray-400 hover:border-white/20 hover:text-gray-300"
        }`}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-xs opacity-70">{description}</span>
    </button>
  );
}

export function MigrationPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { t: tr } = useTranslation("integrations");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>("export");

  // Export state
  const [exportProjects, setExportProjects] = useState<Project[] | null>(null);
  const [exportProjectId, setExportProjectId] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("jira");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Import state
  const [importSource, setImportSource] = useState<ImportSource>("jira");
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<ImportRow[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importProjectId, setImportProjectId] = useState("");
  const [importProjects, setImportProjects] = useState<Project[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; taskIds: string[] } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // AI analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [expandedFindings, setExpandedFindings] = useState<Set<number>>(new Set());

  // Load projects lazily
  const loadProjects = useCallback(async () => {
    if (exportProjects) return;
    try {
      const { projects } = await api.projects.list();
      setExportProjects(projects);
      setImportProjects(projects);
      if (projects[0]) {
        setExportProjectId(projects[0].id);
        setImportProjectId(projects[0].id);
      }
    } catch {
      setExportError(tr("migration.errors.load"));
    }
  }, [exportProjects, tr]);

  // ── Export ──────────────────────────────────────────────────────────────────

  const handleTabChange = (t: Tab) => {
    setTab(t);
    loadProjects();
  };

  const handleExport = async () => {
    if (!exportProjectId) return;
    setExportLoading(true);
    setExportError(null);
    try {
      const url = api.imports.exportCsv(exportProjectId, exportFormat);
      const res = await fetch(url, { headers: await authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: tr("migration.errors.export") }));
        throw new Error(body.error ?? tr("migration.errors.export"));
      }
      const blob = await res.blob();
      const project = exportProjects?.find((p) => p.id === exportProjectId);
      const name = project?.name.replace(/[^a-zA-Z0-9-_]/g, "_") ?? "project";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name}-${exportFormat}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : tr("migration.errors.export"));
    } finally {
      setExportLoading(false);
    }
  };

  // ── Import ──────────────────────────────────────────────────────────────────

  const handleFile = async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      setPreviewError(tr("migration.errors.csvOnly"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPreviewError(tr("migration.errors.tooLarge"));
      return;
    }
    setCsvFileName(file.name);
    setPreviewRows(null);
    setPreviewError(null);
    setImportResult(null);
    setAnalysis(null);

    const text = await file.text();
    setPreviewLoading(true);
    try {
      const result = await api.imports.preview(importProjectId || "preview", {
        source: importSource,
        csv: text,
      });
      setPreviewRows(result.tasks);
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : tr("migration.errors.parse"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const toggleRow = (i: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const toggleFinding = (i: number) => {
    setExpandedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleImport = async () => {
    if (!previewRows?.length || !importProjectId) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await api.imports.import(importProjectId, {
        source: importSource,
        tasks: previewRows,
        created_by: session?.user.id ?? null,
      });
      setImportResult({ imported: result.imported, skipped: result.skipped, taskIds: result.tasks.map((t) => t.id) });
      setPreviewRows(null);
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : tr("migration.errors.import"));
    } finally {
      setImporting(false);
    }
  };

  const handleAnalyze = async () => {
    if (!importResult?.taskIds.length || !importProjectId) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const { analysis: result } = await api.imports.analyze(importProjectId, importResult.taskIds);
      setAnalysis(result);
    } catch (err: unknown) {
      setAnalysisError(err instanceof Error ? err.message : tr("migration.errors.analysis"));
    } finally {
      setAnalyzing(false);
    }
  };

  const findingIcon = (f: ImportAnalysisFinding) => {
    if (f.severity === "high") return <AlertTriangle className="h-4 w-4 shrink-0" />;
    if (f.severity === "medium") return <AlertCircle className="h-4 w-4 shrink-0" />;
    return <Info className="h-4 w-4 shrink-0" />;
  };

  const riskBadge = (level: string) => {
    const map: Record<string, string> = {
      High: "text-red-400 bg-red-500/10 border-red-500/30",
      Medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
      Low: "text-green-400 bg-green-500/10 border-green-500/30",
    };
    return <Badge text={tr("migration.risk", { level })} colorClass={map[level] ?? "text-gray-400 app-surface-soft border-white/10"} />;
  };

  const projects = tab === "export" ? exportProjects : importProjects;

  return (
    <div className="min-h-full px-6 py-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">{tr("migration.title")}</h1>
        <p className="text-sm text-gray-500">
          {tr("migration.subtitle")}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-8 app-surface-soft border border-white/10 rounded-xl p-1 w-fit">
        {(["export", "import"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t
              ? "bg-purple-600 text-white shadow-lg shadow-purple-500/20"
              : "text-gray-400 hover:text-white"
              }`}
          >
            {t === "export" ? <Download className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
            {t === "export" ? tr("migration.export") : tr("migration.import")}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === "export" && (
          <motion.div key="export" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="space-y-6">

            {/* Format */}
            <SectionCard>
              <h2 className="text-sm font-semibold text-white mb-4">{tr("migration.chooseFormat")}</h2>
              <div className="grid grid-cols-2 gap-3">
                <FormatButton format="jira" selected={exportFormat === "jira"} onSelect={() => setExportFormat("jira")} label="Jira CSV" description={tr("migration.jiraDescription")} />
                <FormatButton format="linear" selected={exportFormat === "linear"} onSelect={() => setExportFormat("linear")} label="Linear CSV" description={tr("migration.linearDescription")} />
              </div>
            </SectionCard>

            {/* Project selector */}
            <SectionCard>
              <h2 className="text-sm font-semibold text-white mb-4">{tr("migration.selectProject")}</h2>
              {!projects ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> {tr("migration.loadingProjects")}
                </div>
              ) : (
                <select
                  value={exportProjectId}
                  onChange={(e) => setExportProjectId(e.target.value)}
                  className="w-full rounded-xl border border-white/10 app-surface-soft px-4 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500/60 transition-colors"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-black">{p.name}</option>
                  ))}
                </select>
              )}
            </SectionCard>

            {/* Field mapping reference */}
            <SectionCard>
              <h2 className="text-sm font-semibold text-white mb-3">{tr("migration.fieldMapping")}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="pb-2 text-start text-gray-500 font-medium pe-8">{tr("migration.managerColumn")}</th>
                      <th className="pb-2 text-start text-gray-500 font-medium pe-8">{exportFormat === "jira" ? tr("migration.jiraColumn") : tr("migration.linearColumn")}</th>
                      <th className="pb-2 text-start text-gray-500 font-medium">{tr("migration.notes")}</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-400 space-y-1">
                    {(exportFormat === "jira"
                      ? [
                        [tr("migration.fields.title"), tr("migration.fields.summary"), ""], [tr("migration.fields.description"), tr("migration.fields.description"), ""], [tr("migration.fields.priority"), tr("migration.fields.priority"), tr("migration.noteValues.priorities")], [tr("migration.fields.status"), tr("migration.fields.status"), ""], [tr("migration.fields.estimatedDays"), tr("migration.fields.storyPoints"), tr("migration.noteValues.dayPoint")], [tr("migration.fields.dueDate"), tr("migration.fields.dueDate"), "YYYY-MM-DD"], [tr("migration.fields.labels"), tr("migration.fields.labels"), tr("migration.noteValues.comma")], [tr("migration.fields.acceptance"), tr("migration.fields.acceptance"), tr("migration.noteValues.checklist")], [tr("migration.fields.definition"), tr("migration.fields.implementation"), tr("migration.noteValues.checklist")],
                      ]
                      : [
                        [tr("migration.fields.title"), tr("migration.fields.title"), ""], [tr("migration.fields.description"), tr("migration.fields.description"), tr("migration.noteValues.includesAcceptance")], [tr("migration.fields.priority"), tr("migration.fields.priority"), tr("migration.noteValues.priorities")], [tr("migration.fields.status"), tr("migration.fields.status"), ""], [tr("migration.fields.estimatedDays"), tr("migration.fields.estimate"), ""], [tr("migration.fields.dueDate"), tr("migration.fields.dueDate"), "YYYY-MM-DD"], [tr("migration.fields.labels"), tr("migration.fields.labels"), tr("migration.noteValues.comma")],
                      ]
                    ).map(([src, dest, note]) => (
                      <tr key={src} className="border-b border-white/5">
                        <td className="py-1.5 pr-8 font-medium text-gray-300">{src}</td>
                        <td className="py-1.5 pr-8">{dest}</td>
                        <td className="py-1.5 text-gray-600">{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            {exportError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-900/10 px-4 py-3 text-sm text-red-400">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {exportError}
              </div>
            )}

            <button
              onClick={handleExport}
              disabled={!exportProjectId || exportLoading}
              className="flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 px-6 py-3 text-sm font-semibold text-white transition-colors shadow-lg shadow-purple-500/20"
            >
              {exportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exportLoading ? tr("migration.exporting") : tr("migration.download", { format: exportFormat === "jira" ? "Jira" : "Linear" })}
            </button>
          </motion.div>
        )}

        {tab === "import" && (
          <motion.div key="import" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="space-y-6">

            {/* Source + project */}
            <SectionCard>
              <h2 className="text-sm font-semibold text-white mb-4">{tr("migration.importSource")}</h2>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <FormatButton format="jira" selected={importSource === "jira"} onSelect={() => { setImportSource("jira"); setPreviewRows(null); setCsvFileName(null); }} label={tr("migration.fromJira")} description={tr("migration.uploadJira")} />
                <FormatButton format="linear" selected={importSource === "linear"} onSelect={() => { setImportSource("linear"); setPreviewRows(null); setCsvFileName(null); }} label={tr("migration.fromLinear")} description={tr("migration.uploadLinear")} />
              </div>

              <h2 className="text-sm font-semibold text-white mb-3">{tr("migration.destination")}</h2>
              {!projects ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> {tr("migration.loadingProjects")}
                </div>
              ) : (
                <select
                  value={importProjectId}
                  onChange={(e) => setImportProjectId(e.target.value)}
                  className="w-full rounded-xl border border-white/10 app-surface-soft px-4 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500/60 transition-colors"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-black">{p.name}</option>
                  ))}
                </select>
              )}
            </SectionCard>

            {/* File upload */}
            {!importResult && (
              <SectionCard>
                <h2 className="text-sm font-semibold text-white mb-4">{tr("migration.uploadCsv")}</h2>
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/10 app-surface-soft px-6 py-10 cursor-pointer hover:border-purple-500/40 hover:bg-purple-500/[0.02] transition-all"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 app-surface-soft">
                    {previewLoading ? <Loader2 className="h-5 w-5 text-purple-400 animate-spin" /> : <FileText className="h-5 w-5 text-gray-400" />}
                  </div>
                  {csvFileName ? (
                    <div className="text-center">
                      <p className="text-sm font-medium text-white">{csvFileName}</p>
                      <p className="text-xs text-gray-500 mt-1">{tr("migration.replace")}</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm font-medium text-gray-300">{tr("migration.drop")}</p>
                      <p className="text-xs text-gray-600 mt-1">
                        {importSource === "jira" ? tr("migration.jiraPath") : tr("migration.linearPath")}
                      </p>
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileInput} />
                </div>

                {previewError && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-900/10 px-4 py-3 text-sm text-red-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {previewError}
                  </div>
                )}
              </SectionCard>
            )}

            {/* Preview table */}
            <AnimatePresence>
              {previewRows && previewRows.length > 0 && !importResult && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <SectionCard>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-sm font-semibold text-white">{tr("migration.preview")}</h2>
                        <p className="text-xs text-gray-500 mt-0.5">{tr("migration.ready", { count: previewRows.length })}</p>
                      </div>
                      <button
                        onClick={() => { setPreviewRows(null); setCsvFileName(null); }}
                        className="rounded-lg p-1.5 text-gray-500 hover:text-white hover:app-surface-soft transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                      {previewRows.map((row, i) => (
                        <div key={i} className="rounded-xl border border-white/8 app-surface-soft overflow-hidden">
                          <button
                            onClick={() => toggleRow(i)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:app-surface-soft transition-colors"
                          >
                            <span className="text-xs text-gray-600 w-5 shrink-0">{i + 1}</span>
                            <span className="flex-1 text-sm font-medium text-white truncate">{row.title}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge text={row.priority} colorClass={PRIORITY_COLORS[row.priority] ?? "text-gray-400 app-surface-soft border-white/10"} />
                              <Badge text={row.status} colorClass={STATUS_COLORS[row.status] ?? "text-gray-400 app-surface-soft border-white/10"} />
                              <span className="text-xs text-gray-500">{tr("migration.daysShort", { count: row.estimated_days })}</span>
                              {expandedRows.has(i) ? <ChevronUp className="h-3.5 w-3.5 text-gray-500" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-500" />}
                            </div>
                          </button>

                          <AnimatePresence>
                            {expandedRows.has(i) && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="overflow-hidden"
                              >
                                <div className="px-4 pb-4 pt-2 border-t border-white/8 space-y-3">
                                  {row.description && (
                                    <div>
                                      <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{tr("migration.fields.description")}</p>
                                      <p className="text-xs text-gray-400 leading-relaxed line-clamp-4">{row.description}</p>
                                    </div>
                                  )}
                                  {row.labels.length > 0 && (
                                    <div>
                                      <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">{tr("migration.fields.labels")}</p>
                                      <div className="flex flex-wrap gap-1">
                                        {row.labels.map((l) => (
                                          <span key={l} className="px-1.5 py-0.5 rounded-md border border-white/10 app-surface-soft text-[10px] text-gray-400">{l}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {row.acceptance_criteria.length > 0 && (
                                    <div>
                                      <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">{tr("migration.fields.acceptance")}</p>
                                      <ul className="space-y-1">
                                        {row.acceptance_criteria.slice(0, 4).map((ac) => (
                                          <li key={ac.id} className="text-xs text-gray-400 flex items-start gap-1.5">
                                            <span className="shrink-0 mt-px">◦</span> {ac.text}
                                          </li>
                                        ))}
                                        {row.acceptance_criteria.length > 4 && (
                                          <li className="text-xs text-gray-600">{tr("migration.more", { count: row.acceptance_criteria.length - 4 })}</li>
                                        )}
                                      </ul>
                                    </div>
                                  )}
                                  <div className="flex items-center gap-4 text-xs text-gray-600">
                                    {row.end_date && <span>{tr("migration.due", { date: row.end_date })}</span>}
                                    <span>{tr("migration.externalId", { id: row.external_id })}</span>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>

                    {importError && (
                      <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-900/10 px-4 py-3 text-sm text-red-400">
                        <AlertTriangle className="h-4 w-4 shrink-0" /> {importError}
                      </div>
                    )}

                    <div className="mt-5 flex items-center gap-3">
                      <button
                        onClick={handleImport}
                        disabled={importing || !importProjectId}
                        className="flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 px-6 py-3 text-sm font-semibold text-white transition-colors shadow-lg shadow-purple-500/20"
                      >
                        {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                        {importing ? tr("migration.importing") : tr("migration.importTasks", { count: previewRows.length })}
                      </button>
                      <p className="text-xs text-gray-600">{tr("migration.duplicates")}</p>
                    </div>
                  </SectionCard>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Import result */}
            <AnimatePresence>
              {importResult && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <SectionCard>
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-500/10 border border-green-500/20">
                        <CheckCircle2 className="h-5 w-5 text-green-400" />
                      </div>
                      <div className="flex-1">
                        <h2 className="text-sm font-semibold text-white">{tr("migration.complete")}</h2>
                        <p className="text-xs text-gray-400 mt-1">
                          <span className="text-green-400 font-medium">{tr("migration.imported", { count: importResult.imported })}</span>
                          {importResult.skipped > 0 && <span className="text-gray-500"> · {tr("migration.skipped", { count: importResult.skipped })}</span>}
                        </p>

                        <div className="mt-4 flex flex-wrap gap-3">
                          <button
                            onClick={() => navigate("/")}
                            className="flex items-center gap-2 rounded-xl border border-white/10 app-surface-soft hover:app-surface-soft px-4 py-2.5 text-xs font-medium text-gray-300 hover:text-white transition-colors"
                          >
                            {tr("migration.viewProjects")}
                          </button>
                          {importResult.taskIds.length > 0 && (
                            <button
                              onClick={handleAnalyze}
                              disabled={analyzing}
                              className="flex items-center gap-2 rounded-xl bg-purple-600/20 border border-purple-500/40 hover:bg-purple-600/30 px-4 py-2.5 text-xs font-semibold text-purple-300 hover:text-white transition-colors"
                            >
                              {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                              {analyzing ? tr("migration.analyzing") : tr("migration.analysis")}
                            </button>
                          )}
                          <button
                            onClick={() => { setImportResult(null); setCsvFileName(null); setAnalysis(null); }}
                            className="flex items-center gap-2 rounded-xl border border-white/10 hover:app-surface-soft px-4 py-2.5 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors"
                          >
                            {tr("migration.another")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </SectionCard>
                </motion.div>
              )}
            </AnimatePresence>

            {/* AI Analysis */}
            <AnimatePresence>
              {analysis && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <SectionCard>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-purple-400" />
                        <h2 className="text-sm font-semibold text-white">{tr("migration.analysis")}</h2>
                        {riskBadge(analysis.risk_level)}
                      </div>
                    </div>

                    <p className="text-sm text-gray-400 leading-relaxed mb-5">{analysis.summary}</p>

                    {analysis.findings.length > 0 && (
                      <div className="space-y-2 mb-5">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{tr("migration.findings")}</h3>
                        {analysis.findings.map((f, i) => (
                          <div key={i} className={`rounded-xl border overflow-hidden ${SEVERITY_COLORS[f.severity] ?? "border-white/10 app-surface-soft"}`}>
                            <button
                              onClick={() => toggleFinding(i)}
                              className="w-full flex items-center gap-3 px-4 py-3 text-left"
                            >
                              <span className={SEVERITY_ICON_COLORS[f.severity]}>{findingIcon(f)}</span>
                              <span className="flex-1 text-sm font-medium text-white">{f.title}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <Badge text={f.severity} colorClass={SEVERITY_COLORS[f.severity] ?? "text-gray-400 app-surface-soft border-white/10"} />
                                <Badge text={f.type.replace("_", " ")} colorClass="text-gray-400 app-surface-soft border-white/10" />
                                {expandedFindings.has(i) ? <ChevronUp className="h-3.5 w-3.5 text-gray-500" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-500" />}
                              </div>
                            </button>
                            <AnimatePresence>
                              {expandedFindings.has(i) && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.15 }}
                                  className="overflow-hidden"
                                >
                                  <div className="px-4 pb-4 border-t border-white/8 pt-3 space-y-2">
                                    <p className="text-xs text-gray-400 leading-relaxed">{f.description}</p>
                                    {f.affected_tasks.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-2">
                                        {f.affected_tasks.map((t) => (
                                          <span key={t} className="px-2 py-0.5 rounded-md border border-white/10 app-surface-soft text-[10px] text-gray-400">{t}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        ))}
                      </div>
                    )}

                    {analysis.recommendations.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{tr("migration.recommendations")}</h3>
                        <ul className="space-y-2">
                          {analysis.recommendations.map((r, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                              <span className="shrink-0 mt-0.5 text-purple-400">→</span>
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </SectionCard>
                </motion.div>
              )}
            </AnimatePresence>

            {analysisError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-900/10 px-4 py-3 text-sm text-red-400">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {analysisError}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
