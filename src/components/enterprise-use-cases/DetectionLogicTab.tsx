"use client";

import { useEffect, useState } from "react";
import {
  FileCode2, Wand2, Loader2, Save, CheckCircle2, AlertTriangle, Copy, Check,
  Terminal, Cloud, ShieldCheck, Sparkles, Library, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Choice = "original" | "recommended" | "edited";
type Format = "sigma" | "spl" | "kql";

interface FormatNote {
  source?: "community" | "converted" | "unavailable" | "";
  note?: string;
  refId?: string;
  refSource?: string;
}

interface Props {
  packId: string;                  // EnterpriseUseCase id
  format: string;                  // upload format (sigma|spl|kql|yaml|toml|...)
  originalBody: string;
  recommendedBody: string;         // Sigma recommended
  recommendedSpl: string;
  recommendedKql: string;
  editedBody: string;              // Sigma edited
  editedSpl: string;
  editedKql: string;
  recommendedNotes: { spl?: FormatNote; kql?: FormatNote; generatedAt?: string };
  selected: Choice;
  selectedFormat: Format;
  onUpdated: (next: {
    selectedLogic: Choice;
    selectedFormat: Format;
    editedDetectionLogic: string;
    editedSpl: string;
    editedKql: string;
    recommendedDetectionLogic: string;
    recommendedSpl: string;
    recommendedKql: string;
    recommendedNotes: any;
    validationStatus: string;
    siemCompatibility: Record<string, string>;
  }) => void;
}

const FORMAT_META: Record<Format, { label: string; longLabel: string; Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  sigma: { label: "Sigma",  longLabel: "Sigma YAML",              Icon: ShieldCheck, color: "text-accent"  },
  spl:   { label: "SPL",    longLabel: "Splunk SPL",              Icon: Terminal,    color: "text-warning" },
  kql:   { label: "KQL",    longLabel: "Sentinel / Defender KQL", Icon: Cloud,       color: "text-info"    },
};
const FORMATS: Format[] = ["sigma", "spl", "kql"];
const CHOICES: Choice[] = ["original", "recommended", "edited"];

function currentBody(format: Format, choice: Choice, p: Props): string {
  if (choice === "original") return p.originalBody;
  if (choice === "recommended") {
    if (format === "sigma") return p.recommendedBody;
    if (format === "spl")   return p.recommendedSpl;
    if (format === "kql")   return p.recommendedKql;
  }
  if (choice === "edited") {
    if (format === "sigma") return p.editedBody;
    if (format === "spl")   return p.editedSpl;
    if (format === "kql")   return p.editedKql;
  }
  return "";
}

export default function DetectionLogicTab(props: Props) {
  const { packId, selected, selectedFormat, onUpdated } = props;

  const [formatTab, setFormatTab] = useState<Format>(selectedFormat);
  const [choiceTab, setChoiceTab] = useState<Choice>(selected);
  const [editDraft, setEditDraft] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [generatingMf, setGeneratingMf] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [generateNotes, setGenerateNotes] = useState<string[]>([]);

  useEffect(() => { setChoiceTab(selected); }, [selected]);
  useEffect(() => { setFormatTab(selectedFormat); }, [selectedFormat]);

  useEffect(() => {
    setEditDraft(currentBody(formatTab, choiceTab, props));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatTab, choiceTab, props.editedBody, props.editedSpl, props.editedKql, props.recommendedBody, props.recommendedSpl, props.recommendedKql, props.originalBody]);

  useEffect(() => { if (flash) { const id = setTimeout(() => setFlash(null), 2000); return () => clearTimeout(id); } }, [flash]);

  const splNote = props.recommendedNotes?.spl;
  const kqlNote = props.recommendedNotes?.kql;
  const noteForFormat: FormatNote | undefined = formatTab === "spl" ? splNote : formatTab === "kql" ? kqlNote : undefined;

  const generateSigma = async () => {
    setGenerating(true); setError(null); setGenerateNotes([]);
    try {
      const res = await fetch(`/api/enterprise-use-cases/${packId}/recommend`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "generate failed"); return; }
      setGenerateNotes(data.notes || []);
      onUpdated({
        selectedLogic: selected, selectedFormat,
        editedDetectionLogic: props.editedBody, editedSpl: props.editedSpl, editedKql: props.editedKql,
        recommendedDetectionLogic: data.recommendedDetectionLogic,
        recommendedSpl: props.recommendedSpl, recommendedKql: props.recommendedKql,
        recommendedNotes: props.recommendedNotes,
        validationStatus: "", siemCompatibility: {},
      });
      setFormatTab("sigma"); setChoiceTab("recommended");
      setFlash(data.isAlreadySigma ? "Recommended (Sigma-normalised)" : "Recommended Sigma generated");
    } catch (err: any) {
      setError(err?.message || "generate failed");
    } finally { setGenerating(false); }
  };

  const generateMultiFormat = async () => {
    setGeneratingMf(true); setError(null);
    try {
      const res = await fetch(`/api/enterprise-use-cases/${packId}/generate-multi-format`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "multi-format generation failed"); return; }
      onUpdated({
        selectedLogic: selected, selectedFormat,
        editedDetectionLogic: props.editedBody, editedSpl: props.editedSpl, editedKql: props.editedKql,
        recommendedDetectionLogic: props.recommendedBody,
        recommendedSpl: data.spl.body, recommendedKql: data.kql.body,
        recommendedNotes: {
          spl: { source: data.spl.source, note: data.spl.note, refId: data.spl.communityRefId, refSource: data.spl.communityRefSource },
          kql: { source: data.kql.source, note: data.kql.note, refId: data.kql.communityRefId, refSource: data.kql.communityRefSource },
          generatedAt: new Date().toISOString(),
        },
        validationStatus: "", siemCompatibility: {},
      });
      setFlash(`SPL: ${data.spl.source} · KQL: ${data.kql.source}`);
    } catch (err: any) {
      setError(err?.message || "multi-format generation failed");
    } finally { setGeneratingMf(false); }
  };

  const saveEdit = async (selectAsCurrent: boolean) => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/enterprise-use-cases/${packId}/multi-format-logic`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: formatTab, body: editDraft, selectAsCurrent }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "save failed"); return; }
      const nextEditedBody = formatTab === "sigma" ? editDraft : props.editedBody;
      const nextEditedSpl  = formatTab === "spl"   ? editDraft : props.editedSpl;
      const nextEditedKql  = formatTab === "kql"   ? editDraft : props.editedKql;
      onUpdated({
        selectedLogic: selectAsCurrent ? "edited" : selected,
        selectedFormat: selectAsCurrent ? formatTab : selectedFormat,
        editedDetectionLogic: nextEditedBody, editedSpl: nextEditedSpl, editedKql: nextEditedKql,
        recommendedDetectionLogic: props.recommendedBody, recommendedSpl: props.recommendedSpl, recommendedKql: props.recommendedKql,
        recommendedNotes: props.recommendedNotes,
        validationStatus: "", siemCompatibility: {},
      });
      setChoiceTab("edited");
      setFlash(selectAsCurrent ? `Saved edited ${formatTab} as current` : `Saved edited ${formatTab}`);
    } catch (err: any) {
      setError(err?.message || "save failed");
    } finally { setSaving(false); }
  };

  const setCurrent = async () => {
    try {
      setSaving(true); setError(null);
      const res = await fetch(`/api/enterprise-use-cases/${packId}/selected-logic`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice: choiceTab, format: formatTab }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "set-current failed"); return; }
      onUpdated({
        selectedLogic: choiceTab, selectedFormat: formatTab,
        editedDetectionLogic: props.editedBody, editedSpl: props.editedSpl, editedKql: props.editedKql,
        recommendedDetectionLogic: props.recommendedBody, recommendedSpl: props.recommendedSpl, recommendedKql: props.recommendedKql,
        recommendedNotes: props.recommendedNotes,
        validationStatus: data.validationStatus || "", siemCompatibility: data.siemCompatibility || {},
      });
      setFlash(`Selected: ${choiceTab} · ${formatTab}`);
    } finally { setSaving(false); }
  };

  const meta = FORMAT_META[formatTab];
  const body = currentBody(formatTab, choiceTab, props);
  const isEdit = choiceTab === "edited";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <FileCode2 className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Detection logic</h2>

          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {FORMATS.map((f) => {
              const fm = FORMAT_META[f];
              const isSel = selectedFormat === f;
              const isTab = formatTab === f;
              return (
                <button
                  key={f}
                  onClick={() => setFormatTab(f)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                    isTab ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover",
                  )}
                  title={fm.longLabel}
                >
                  <fm.Icon className={cn("h-3 w-3", isTab ? "text-accent" : fm.color)} />
                  {fm.label}
                  {isSel && <CheckCircle2 className="h-3 w-3 text-success" />}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {formatTab !== "sigma" && (
              <button
                onClick={generateMultiFormat}
                disabled={generatingMf || !props.recommendedBody}
                className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium rounded-md border border-info/40 text-info hover:bg-info/10 disabled:opacity-50"
                title={!props.recommendedBody ? "Generate Recommended Sigma first" : "Regenerate SPL + KQL from the current Sigma body"}
              >
                {generatingMf ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Regenerate {meta.label}
              </button>
            )}
          </div>
        </div>

        <div className="px-4 py-2 border-b border-border bg-background/30 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Body:</span>
          <div className="inline-flex rounded border border-border overflow-hidden">
            {CHOICES.map((c) => {
              const has = !!currentBody(formatTab, c, props);
              const isSel = selected === c && selectedFormat === formatTab;
              const isTab = choiceTab === c;
              return (
                <button
                  key={c}
                  onClick={() => setChoiceTab(c)}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors",
                    isTab ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground",
                    !has && "opacity-50",
                  )}
                  title={has ? `Switch to ${c}` : "Empty"}
                >
                  {c}
                  {isSel && <CheckCircle2 className="h-3 w-3 text-success" />}
                </button>
              );
            })}
          </div>

          {(choiceTab !== selected || formatTab !== selectedFormat) && choiceTab !== "edited" && (
            <button
              onClick={setCurrent}
              disabled={saving}
              className="ml-auto inline-flex items-center gap-1 h-7 px-2 text-[11px] rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Use this as current
            </button>
          )}
        </div>

        {noteForFormat && (noteForFormat.note || noteForFormat.source) && (
          <div className={cn(
            "px-4 py-1.5 text-[10px] border-b border-border flex items-start gap-1.5",
            noteForFormat.source === "community" && "bg-success/5 text-success",
            noteForFormat.source === "converted" && "bg-info/5 text-info",
            noteForFormat.source === "unavailable" && "bg-warning/5 text-warning",
          )}>
            {noteForFormat.source === "community" ? <Library className="h-3 w-3 mt-0.5" />
              : noteForFormat.source === "converted" ? <Sparkles className="h-3 w-3 mt-0.5" />
              : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <div className="min-w-0 flex-1">
              <strong className="uppercase mr-1">{noteForFormat.source}:</strong>{noteForFormat.note}
              {noteForFormat.refId && noteForFormat.refSource === "splunk" && (
                <a href={`/community/splunk/${noteForFormat.refId}`} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 hover:underline">
                  view source <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
              {noteForFormat.refId && noteForFormat.refSource === "unified" && (
                <a href={`/community/sentinel/${noteForFormat.refId}`} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 hover:underline">
                  view source <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
          </div>
        )}

        {flash && (
          <div className="px-4 py-1.5 border-b border-success/30 bg-success/10 text-[11px] text-success inline-flex items-center gap-2 w-full">
            <CheckCircle2 className="h-3.5 w-3.5" /> {flash}
          </div>
        )}
        {error && (
          <div className="px-4 py-1.5 border-b border-danger/30 bg-danger/10 text-[11px] text-danger inline-flex items-center gap-2 w-full">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </div>
        )}

        {isEdit ? (
          <div className="p-4 space-y-2">
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              rows={20}
              spellCheck={false}
              placeholder={`Paste / type your tuned ${meta.longLabel} here…`}
              className="w-full px-3 py-2 text-[11px] font-mono rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent resize-vertical"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => saveEdit(false)}
                disabled={saving || !editDraft.trim()}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-border text-foreground hover:bg-card-hover disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save edits
              </button>
              <button
                onClick={() => saveEdit(true)}
                disabled={saving || !editDraft.trim()}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save + set as current
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Edits to {meta.longLabel} persist independently from the other formats. SIEM coverage testing always runs against the selected logic body.
            </p>
          </div>
        ) : (
          <BodyViewer body={body} format={formatTab} onEdit={() => { setEditDraft(body); setChoiceTab("edited"); }} />
        )}
      </div>

      {!props.recommendedBody && (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-6 text-center">
          <Wand2 className="h-7 w-7 mx-auto mb-2 text-accent opacity-70" />
          <h3 className="text-sm font-semibold text-foreground">No Recommended Sigma yet</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Synthesize a canonical Sigma body deterministically from the original + techniques + platforms.
            SPL and KQL variants will be generated from it.
          </p>
          <button
            onClick={generateSigma}
            disabled={generating}
            className="mt-3 inline-flex items-center gap-1.5 h-8 px-4 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Generate Recommended
          </button>
        </div>
      )}

      {generateNotes.length > 0 && (
        <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-[10px] text-info">
          <strong>Synth notes:</strong>
          <ul className="ml-3 mt-0.5 list-disc">
            {generateNotes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function BodyViewer({ body, format, onEdit }: { body: string; format: Format; onEdit: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!body) {
    return (
      <div className="p-6 text-center">
        <div className="text-xs text-muted-foreground mb-2">No body for this choice yet.</div>
        <button onClick={onEdit} className="text-[11px] text-accent hover:underline">Start an edit instead →</button>
      </div>
    );
  }
  return (
    <div>
      <div className="px-4 py-1.5 border-b border-border bg-background/30 flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{format}</span>
        <button onClick={onEdit} className="text-[10px] text-accent hover:underline">Edit this →</button>
        <button
          onClick={() => { navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="px-4 py-3 text-[11px] font-mono text-foreground bg-background/60 max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words">
{body}
      </pre>
    </div>
  );
}
