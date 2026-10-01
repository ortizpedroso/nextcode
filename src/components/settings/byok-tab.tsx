"use client";

import { useState } from "react";
import { authFetch } from "@/lib/client-session";
import {
  Key,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Zap,
  Globe,
  Save,
} from "lucide-react";
import { SettingsFormState } from "./settings-dialog";

interface ByokTabProps {
  settings: SettingsFormState;
  onUpdateSettings: (updated: SettingsFormState) => void;
  onSave: () => Promise<void>;
}

interface KeyTestState {
  testing: boolean;
  ok?: boolean;
  warning?: boolean;
  message?: string;
}

export function ByokTab({ settings, onUpdateSettings, onSave }: ByokTabProps) {
  const [testStates, setTestStates] = useState<Record<string, KeyTestState>>({});
  const [saving, setSaving] = useState(false);

  const handleKeyChange = (field: keyof SettingsFormState, value: string) => {
    onUpdateSettings({
      ...settings,
      [field]: value,
    });
    // Limpa o status de teste anterior ao modificar a chave
    if (testStates[field]) {
      setTestStates((prev) => ({
        ...prev,
        [field]: { testing: false },
      }));
    }
  };

  const testKey = async (provider: string, fieldName: keyof SettingsFormState, baseUrl?: string) => {
    const keyToTest = settings[fieldName];
    if (!keyToTest || !keyToTest.trim()) {
      setTestStates((prev) => ({
        ...prev,
        [fieldName]: { testing: false, ok: false, message: "Insira uma chave antes de testar." },
      }));
      return;
    }

    setTestStates((prev) => ({
      ...prev,
      [fieldName]: { testing: true },
    }));

    try {
      const res = await authFetch("/api/byok/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: keyToTest,
          baseUrl,
        }),
      });

      const data = await res.json();
      setTestStates((prev) => ({
        ...prev,
        [fieldName]: {
          testing: false,
          ok: data.success,
          // FIX ("verde mas quebrado"): o backend agora distingue "chave autentica" de
          // "chave que realmente gera conteúdo". warning=true pinta âmbar na UI.
          warning: Boolean(data.warning),
          message: data.message || (data.success ? "Chave Válida e Ativa!" : "Erro ao validar chave"),
        },
      }));
    } catch (err) {
      setTestStates((prev) => ({
        ...prev,
        [fieldName]: {
          testing: false,
          ok: false,
          message: `Erro de rede: ${String(err)}`,
        },
      }));
    }
  };

  const handleSaveForm = async () => {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  const renderProviderRow = (
    label: string,
    provider: string,
    field: keyof SettingsFormState,
    getKeyUrl: string,
    placeholder: string,
    baseUrl?: string
  ) => {
    const status = testStates[field];

    return (
      <div className="space-y-1.5 p-4 rounded-xl bg-slate-50/60 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Key className="w-3.5 h-3.5 text-[#0066cc]" />
            {label}
          </label>
          <a
            href={getKeyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[#0066cc] hover:underline flex items-center gap-1 font-medium"
          >
            <span>Obter chave na plataforma</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="flex gap-2 items-center">
          <input
            type="password"
            placeholder={placeholder}
            value={settings[field]}
            onChange={(e) => handleKeyChange(field, e.target.value)}
            className="flex-1 bg-white dark:bg-slate-950 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 font-mono shadow-sm"
          />

          {/* Botão de Testar Conexão Inline */}
          <button
            type="button"
            onClick={() => testKey(provider, field, baseUrl)}
            disabled={status?.testing || !settings[field]?.trim()}
            className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40 shrink-0 border border-slate-200/80 dark:border-slate-700"
          >
            {status?.testing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0066cc]" />
                <span>Verificando...</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                <span>Testar Conexão</span>
              </>
            )}
          </button>
        </div>

        {/* Feedback Visual de Validação */}
        {status && !status.testing && status.message && (
          <div className="pt-1">
            {status.ok ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-md">
                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                {status.message}
              </span>
            ) : status.warning ? (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-md"
                title={status.message}
              >
                <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                {status.message}
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded-md"
                title={status.message}
              >
                <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400" />
                {status.message}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="bg-blue-50/50 dark:bg-blue-950/40 p-3 rounded-xl border border-blue-200/60 dark:border-blue-800/60 text-slate-700 dark:text-slate-300 leading-relaxed text-[11px]">
        Insira suas chaves de API próprias para utilizar o modelo <strong>BYOK (Bring Your Own Key)</strong>. Suas chaves são criptografadas e mantidas localmente na sua máquina.
      </div>

      <div className="space-y-3">
        {renderProviderRow(
          "Google Gemini (Flash / Pro)",
          "gemini",
          "geminiKey",
          "https://aistudio.google.com/app/apikey",
          "AIzaSy..."
        )}

        {renderProviderRow(
          "Anthropic Claude (Sonnet / Haiku)",
          "claude",
          "claudeKey",
          "https://console.anthropic.com/settings/keys",
          "sk-ant-api..."
        )}

        {renderProviderRow(
          "OpenAI (GPT-4o / o1)",
          "openai",
          "openaiKey",
          "https://platform.openai.com/api-keys",
          "sk-proj-..."
        )}

        {renderProviderRow(
          "DeepSeek API",
          "deepseek",
          "deepseekKey",
          "https://platform.deepseek.com/api_keys",
          "sk-..."
        )}

        {renderProviderRow(
          "Groq Cloud (Llama 3.3 / DeepSeek / Mixtral)",
          "groq",
          "groqKey",
          "https://console.groq.com/keys",
          "gsk_..."
        )}

        {renderProviderRow(
          "NVIDIA NIM Cloud (Llama 3.3 / Nemotron)",
          "nvidia",
          "nvidiaKey",
          "https://build.nvidia.com/",
          "nvapi-..."
        )}

        {renderProviderRow(
          "OpenRouter / Gateway Customizado",
          "omniRoute",
          "omniRouteKey",
          "https://openrouter.ai/keys",
          "sk-or-...",
          settings.customEndpoint
        )}
      </div>

      {/* Salvar Configurações */}
      <div className="pt-2 flex justify-end">
        <button
          onClick={handleSaveForm}
          disabled={saving}
          className="px-4 py-2 bg-[#0066cc] hover:bg-blue-700 text-white rounded-xl font-medium text-xs flex items-center gap-1.5 shadow-sm disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Salvando...</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span>Salvar Configurações BYOK</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
