import axios from 'axios';
import { PcasConfig } from './types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 로컬 LLM에 chat 요청을 보내고 응답 텍스트를 반환한다. Ollama / OpenAI 호환 모두 지원. */
export async function callLocalLlm(
  messages: ChatMessage[],
  config: PcasConfig,
  model?: string
): Promise<string> {
  const resolvedModel = model || config.localModelName || 'gemma2:2b';
  const timeout = config.requestTimeout * 1000;

  if (config.apiType === 'openai') {
    const { data } = await axios.post(
      `${config.localUrl}/v1/chat/completions`,
      { model: resolvedModel, messages, stream: false },
      { timeout }
    );
    return (data.choices?.[0]?.message?.content ?? '') as string;
  }

  // Ollama
  const { data } = await axios.post(
    `${config.localUrl}/api/chat`,
    { model: resolvedModel, messages, stream: false },
    { timeout }
  );
  return (data.message?.content ?? '') as string;
}

/** 엔진에서 사용 가능한 모델 ID 목록을 반환한다. */
export async function listLocalModels(baseUrl: string, apiType: 'ollama' | 'openai'): Promise<string[]> {
  if (apiType === 'openai') {
    const { data } = await axios.get(`${baseUrl}/v1/models`, { timeout: 5000 });
    return ((data.data ?? []) as Array<{ id: string }>).map(m => m.id);
  }
  const { data } = await axios.get(`${baseUrl}/api/tags`, { timeout: 5000 });
  return ((data.models ?? []) as Array<{ name: string }>)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(m => m.name);
}

/** 첫 번째 사용 가능한 모델을 반환한다. 없으면 폴백값. */
export async function detectLocalModel(config: PcasConfig): Promise<string> {
  try {
    const models = await listLocalModels(config.localUrl, config.apiType);
    if (models.length === 0) throw new Error('모델 없음');
    return models[0];
  } catch {
    return config.apiType === 'openai' ? 'local-model' : 'gemma2:2b';
  }
}
