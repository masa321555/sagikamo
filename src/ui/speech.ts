// 音声入力（Web Speech API）と読み上げ（SpeechSynthesis）のヘルパー。
// 非対応ブラウザではボタン自体を出さない（graceful degradation）。

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition as SpeechRecognitionCtor) ?? (w.webkitSpeechRecognition as SpeechRecognitionCtor) ?? null;
}

export function isDictationSupported(): boolean {
  // Web Speech APIはセキュアコンテキスト（HTTPS/localhost）必須。
  // LAN経由のHTTPアクセス等ではAPI自体が無効になるため、ボタンを出さずキーボード音声入力の案内に切り替える
  return window.isSecureContext && getRecognitionCtor() !== null;
}

export interface DictationHandle {
  stop: () => void;
}

/** 音声入力を開始する。確定した文節ごとに onFinalText が呼ばれる */
export function startDictation(
  onFinalText: (text: string) => void,
  onEnd: () => void,
  onError: (message: string) => void,
): DictationHandle | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "ja-JP";
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) onFinalText(r[0].transcript);
    }
  };
  rec.onend = onEnd;
  rec.onerror = (e) => {
    onError(
      e.error === "not-allowed"
        ? "マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。"
        : "音声を聞き取れませんでした。もう一度お試しください。",
    );
  };
  rec.start();
  return { stop: () => rec.stop() };
}

export function isSpeakSupported(): boolean {
  return "speechSynthesis" in window;
}

/** テキストを読み上げる。呼び出し側で stopSpeaking() による停止が可能 */
export function speak(text: string, onEnd: () => void): void {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 0.95;
  u.onend = onEnd;
  u.onerror = onEnd;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
