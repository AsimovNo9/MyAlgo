import './index.ts';
import { runPersonalAlgorithmLiveDiagnostic } from './personal-algorithm-diagnostic.ts';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'PERSONAL_ALGORITHM_SCORE_DIAGNOSTIC') return false;

  void runPersonalAlgorithmLiveDiagnostic()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));

  return true;
});
