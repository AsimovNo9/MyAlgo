import { STORAGE_KEYS } from '../lib/storage';
import { EXTENSION_MESSAGE_TYPES } from '../lib/messaging';
import { MYALGO_INJECTED_SELECTOR, buildExplanationViewModel, buildModeSupplyPlan, createReplacementSelectionSeed, createReplacementSlotId, dedupeCandidatesById, getCandidateAcquisitionLabel, getContentPresentationLabel, getNativeCardDecision, getReplacementCandidates, getReplacementPresentationMetadata, getReplacementTextMetadata, getSourceShelfHideReason, isDurableModeGroundedItem, isProvisionalDurableModeRelevantItem, isMyAlgoInjectedElement, isRenderContextStale, isReplacementEligibleNativeDecision, isStableReplacementCandidateAvailableToSource, isStableReplacementCandidateEligible, isStableReplacementSourceSlotPrebound, keepOutermostElements, navigationFinishRerankReason, planReplacementAssignments, replacementQuota, selectFeedMixAssignments, shouldHideForSourceFilters, shouldClearSourceFilteredPresentation, shouldInvalidateStableReplacementBindings, shouldPreserveReplacementOwnedPresentation } from './youtube-ux';
import type { DurableModePresentationContext, ModeSupplyPlan, RankedFeedItem, ReplacementRerankReason } from './youtube-ux';
import { youtubeConnector } from '../connectors/youtube';

import type { DurableSemanticModeCatalog, FeedSourceFilters, ModeSupplyDiagnostics } from '@repo/shared-types';
import { isPrivacyDisclosureAccepted } from '../lib/privacy';
import { collectHistoryEvidenceFromDom, isYouTubeHistoryPage } from './youtube-history';
import { collectRecommendationObservationsFromDom, isYouTubeHomePage } from './youtube-recommendations';
import { createSelectionObservation, getSelectionFromTarget, getYouTubeSurface } from './youtube-interactions';
import {
  advanceWatchSession,
  createTemporalWatchObservation,
  createWatchSession,
  markWatchEmitted,
  resetWatchSeek,
  type WatchSessionState,
} from './youtube-watch';

const videoSelectors = youtubeConnector.cardSelectors;
const videoLinkSelector = youtubeConnector.videoLinkSelector;

const YOUTUBE_COMMENT_SURFACE_SELECTOR = [
  '#comments',
  'ytd-comment-thread-renderer',
  'ytd-comment-view-model',
  'yt-comment-thread-renderer',
  'yt-comment-view-model',
].join(', ');

const isYouTubeCommentSurfaceElement = (element: Element | null): boolean => (
  Boolean(element?.closest(YOUTUBE_COMMENT_SURFACE_SELECTOR))
);

type PresentationCache = {
  mode: string;
  activeModeId: string;
  activeModeRevision: number | null;
  generatedAt: string;
  feed: RankedFeedItem[];
};

let cachedFeed: RankedFeedItem[] = [];
let rankingInFlight = false;
let activeMode = 'Default';
let rankGeneration = 0;
let rankTimer: number | undefined;
let mutationRankTimer: number | undefined;
let rankQueued = false;
let statusDismissTimer: number | undefined;
let resizeTimer: number | undefined;
let historyObservationTimer: number | undefined;
let recommendationObservationTimer: number | undefined;
let optimisticPresentationFrame: number | undefined;
let extensionEnabled = false;
let lastCandidateSignature = '';
let lastRankMode = '';
let sourceFilters: FeedSourceFilters = {};
let feedReplacementPercent = 0;
let activeDurableMode: DurableModePresentationContext | null = null;
let latestModeSupplyPlan: ModeSupplyPlan | null = null;
let lastModeSupplySignature = '';
let lastSelectionInteraction: { signature: string; kind: 'click' | 'auxclick' | 'keyboard'; at: number } | null = null;
const WATCH_SELECTION_INTENT_MAX_AGE_MS = 15_000;
let pendingWatchExposure: { videoId: string; exposureId: string | null; observedAt: number } | null = null;
let watchedVideo: HTMLVideoElement | null = null;
let watchSession: WatchSessionState | null = null;
let watchSessionSequence = 0;
let replacementBindingRevision = 0;
let lastReplacementInvalidationReason: ReplacementRerankReason | 'initial' = 'initial';
let navigationInvalidationPending = false;
let explanationPanelSequence = 0;
const stableReplacementBySourceId = new Map<string, {
  candidateId: string;
  item: RankedFeedItem;
  routeKey: string;
  bindingRevision: number;
}>();


const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const instanceAttribute = 'data-personal-algorithm-instance';
document.documentElement.setAttribute(instanceAttribute, instanceId);

const isCurrentInstance = () => document.documentElement.getAttribute(instanceAttribute) === instanceId;
const getRouteKey = () => `${location.pathname}${location.search}`;
const invalidateStableReplacements = (reason: ReplacementRerankReason) => {
  replacementBindingRevision += 1;
  lastReplacementInvalidationReason = reason;
  stableReplacementBySourceId.clear();
};

const logStaleRender = (phase: string, requestGeneration: number) => {
  console.info('[MyAlgo] skipped stale render', {
    phase,
    requestGeneration,
    latestGeneration: rankGeneration,
  });
};

const isExtensionContextValid = () => {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
};

const safeSendMessage = (
  message: unknown,
  callback?: (response: any) => void,
) => {
  if (!isExtensionContextValid()) return false;
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return;
      callback?.(response);
    });
    return true;
  } catch {
    return false;
  }
};

const safeStorageGet = (keys: string[]): Promise<Record<string, unknown>> => {
  if (!isExtensionContextValid()) return Promise.resolve({});
  try {
    return chrome.storage.local
      .get(keys)
      .then((result) => result as Record<string, unknown>)
      .catch(() => ({}));
  } catch {
    return Promise.resolve({});
  }
};

const resolveDurableModeContext = (
  activeModeId: unknown,
  catalog: DurableSemanticModeCatalog | null | undefined,
): DurableModePresentationContext | null => {
  const id = typeof activeModeId === 'string' ? activeModeId.trim() : '';
  if (!id || id === 'default') return null;
  const mode = catalog?.modes.find((entry) => entry.id === id);
  return mode
    ? {
        id: mode.id,
        label: mode.label,
        revision: mode.revision,
        memberLabels: mode.members.map((member) => member.label),
      }
    : null;
};

const persistModeSupplyDiagnostics = (
  plan: ModeSupplyPlan | null,
  filledFromPool: number,
) => {
  const diagnostics: ModeSupplyDiagnostics | null = plan
    ? {
        generatedAt: new Date().toISOString(),
        modeId: plan.modeId,
        modeRevision: plan.modeRevision,
        modeLabel: plan.modeLabel,
        sliderPercent: plan.sliderPercent,
        eligibleNativeSlots: plan.eligibleNativeSlots,
        requestedModeSlots: plan.requestedModeSlots,
        nativeModeSupply: plan.nativeModeSupply,
        poolModeSupply: plan.poolModeSupply,
        shortfall: plan.shortfall,
        fulfilledModeSlots: Math.min(
          plan.requestedModeSlots,
          plan.nativeModeSupply + Math.max(0, filledFromPool),
        ),
        bannerShown: plan.shortfall > 0,
      }
    : null;

  const signature = diagnostics
    ? JSON.stringify({
        ...diagnostics,
        generatedAt: undefined,
      })
    : 'none';
  if (signature === lastModeSupplySignature) return;
  lastModeSupplySignature = signature;

  safeSendMessage({
    type: 'MODE_SUPPLY_DIAGNOSTICS',
    payload: { modeSupply: diagnostics },
  });

  if (diagnostics?.shortfall) {
    showStatus(
      `Not enough native ${diagnostics.modeLabel} supply · ${diagnostics.nativeModeSupply}/${diagnostics.requestedModeSlots} native · ${diagnostics.poolModeSupply} available from MyAlgo pool`,
    );
  }
};

const showStatus = (message: string, error = false, paused = false) => {
  if (!isCurrentInstance()) return;
  let status = document.querySelector<HTMLElement>('[data-personal-algorithm-status]');
  if (!status) {
    status = document.createElement('div');
    status.dataset.personalAlgorithmStatus = 'true';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:72px;pointer-events:none;max-width:min(320px,calc(100vw - 24px));padding:10px 14px;border-radius:14px;border:1px solid rgba(148,163,184,0.35);font:700 12px/1.3 sans-serif;letter-spacing:0.02em;box-shadow:0 10px 26px rgba(15,23,42,0.38);';
    document.body.appendChild(status);
  }

  const isError = error || (!paused && message.toLowerCase().includes('failed'));
  status.style.background = isError ? '#7f1d1d' : paused ? '#374151' : '#14532d';
  status.style.color = '#f8fafc';
  status.style.borderColor = isError ? 'rgba(248,113,113,0.7)' : paused ? 'rgba(148,163,184,0.7)' : 'rgba(52,211,153,0.7)';
  status.textContent = message;
  if (statusDismissTimer !== undefined) window.clearTimeout(statusDismissTimer);
  const dismissAfter = isError ? 8000 : 3500;
  statusDismissTimer = window.setTimeout(() => {
    if (status?.isConnected && status.textContent === message) status.remove();
    statusDismissTimer = undefined;
  }, dismissAfter);
};

const normalizeText = (value: string) => youtubeConnector.normalizeText(value).toLowerCase();

const clearExtensionPresentation = (
  showPaused = true,
  preserveReplacements = false,
) => {
  document.querySelector('[data-personal-algorithm-shelf]')?.remove();
  document.querySelectorAll<HTMLElement>(
    '[data-personal-algorithm-replacement], [data-personal-algorithm-explanation], [data-personal-algorithm-explanation-panel], [data-personal-algorithm-control]',
  ).forEach((element) => {
    if (
      preserveReplacements
      && (
        element.matches('[data-personal-algorithm-replacement]')
        || element.closest('[data-personal-algorithm-replacement]')
      )
    ) return;

    if (preserveReplacements && element.matches('[data-personal-algorithm-explanation-panel]') && !element.hidden) {
      return;
    }
    if (preserveReplacements && element.matches('[data-personal-algorithm-explanation]')) {
      const panelId = element.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;
      if (panel && !panel.hidden) return;
    }
    element.remove();
  });
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-badge]').forEach((badge) => {
    if (shouldPreserveReplacementOwnedPresentation(
      preserveReplacements,
      Boolean(badge.closest('[data-personal-algorithm-replacement]')),
    )) return;
    badge.remove();
  });
  if (shouldClearSourceFilteredPresentation(showPaused, extensionEnabled)) {
    document.querySelectorAll<HTMLElement>(
      '[data-personal-algorithm-source-shelf-hidden], [data-personal-algorithm-source-row-hidden], [data-personal-algorithm-source-section-hidden], [data-personal-algorithm-source-layout-hidden]',
    ).forEach((container) => {
      container.style.removeProperty('display');
      delete container.dataset.personalAlgorithmSourceShelfHidden;
      delete container.dataset.personalAlgorithmSourceRowHidden;
      delete container.dataset.personalAlgorithmSourceSectionHidden;
      delete container.dataset.personalAlgorithmSourceLayoutHidden;
    });
  }
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-position-patched="true"]').forEach((element) => {
    element.style.removeProperty('position');
    delete element.dataset.personalAlgorithmPositionPatched;
  });
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-score]').forEach((element) => {
    element.style.removeProperty('display');
    element.style.outline = '';
    element.style.outlineOffset = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;
    delete element.dataset.personalAlgorithmSlotId;
    delete element.dataset.personalAlgorithmSlotWidth;
    delete element.dataset.personalAlgorithmSlotHeight;
    delete element.dataset.personalAlgorithmReplacementCandidateId;
    delete element.dataset.personalAlgorithmSourceScore;
  });
  if (showPaused) {
    showStatus('Personal Algorithm: Paused', false, true);
  } else {
    document.querySelector('[data-personal-algorithm-status]')?.remove();
  }
};

const getExplanationTrigger = (panel: HTMLElement): HTMLElement | null => {
  const triggerId = panel.dataset.personalAlgorithmExplanationTriggerId;
  return triggerId ? document.getElementById(triggerId) : null;
};

const positionExplanationPanel = (trigger: HTMLElement, panel: HTMLElement) => {
  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(520, Math.max(300, window.innerWidth - margin * 2));
  const left = Math.min(
    window.innerWidth - width - margin,
    Math.max(margin, rect.right - width),
  );
  const belowSpace = window.innerHeight - rect.bottom - margin;
  const aboveSpace = rect.top - margin;
  const openBelow = belowSpace >= Math.min(360, aboveSpace);
  const maxHeight = Math.max(220, Math.min(560, openBelow ? belowSpace : aboveSpace));
  panel.style.position = 'fixed';
  panel.style.zIndex = '2147483646';
  panel.style.left = `${left}px`;
  panel.style.width = `${width}px`;
  panel.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
  panel.style.maxHeight = `${maxHeight}px`;
  panel.style.right = 'auto';
  if (openBelow) {
    panel.style.top = `${Math.min(window.innerHeight - maxHeight - margin, rect.bottom + margin)}px`;
    panel.style.bottom = 'auto';
  } else {
    panel.style.bottom = `${Math.max(margin, window.innerHeight - rect.top + margin)}px`;
    panel.style.top = 'auto';
  }
};

const setExplanationPanelOpen = (panel: HTMLElement, open: boolean) => {
  const trigger = getExplanationTrigger(panel);
  if (open && trigger) positionExplanationPanel(trigger, panel);
  panel.hidden = !open;
  trigger?.setAttribute('aria-expanded', String(open));
};

const closeOtherExplanationPanels = (keep: HTMLElement) => {
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-explanation-panel]').forEach((panel) => {
    if (panel === keep || panel.hidden) return;
    setExplanationPanelOpen(panel, false);
  });
};

const createExplanationPortal = (
  trigger: HTMLButtonElement,
  kind: 'native' | 'replacement',
): HTMLElement => {
  explanationPanelSequence += 1;
  const suffix = `${instanceId}-${explanationPanelSequence}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  if (!trigger.id) trigger.id = `myalgo-explanation-trigger-${suffix}`;
  const panel = document.createElement('div');
  panel.id = `myalgo-explanation-panel-${suffix}`;
  panel.dataset.personalAlgorithmExplanationPanel = kind;
  panel.dataset.personalAlgorithmExplanationTriggerId = trigger.id;
  panel.hidden = true;
  panel.style.cssText = 'position:fixed;z-index:2147483646;overflow:auto;border:1px solid rgba(148,163,184,.45);border-radius:12px;background:#171717;color:#f8fafc;font:500 12px/1.45 Roboto,Arial,sans-serif;white-space:normal;box-shadow:0 12px 40px rgba(0,0,0,.65);';
  panel.addEventListener('pointerdown', (event) => event.stopPropagation());
  panel.addEventListener('click', (event) => event.stopPropagation());
  trigger.setAttribute('aria-controls', panel.id);
  document.body.appendChild(panel);
  return panel;
};

const ensureExplanationPortalForTrigger = (
  trigger: HTMLButtonElement,
  kind: 'native' | 'replacement',
): HTMLElement => {
  if (trigger.id) {
    const firstWithId = document.getElementById(trigger.id);
    if (firstWithId && firstWithId !== trigger) {
      trigger.removeAttribute('id');
      trigger.removeAttribute('aria-controls');
    }
  }

  const controlledPanelId = trigger.getAttribute('aria-controls');
  let panel = controlledPanelId
    ? document.getElementById(controlledPanelId) as HTMLElement | null
    : null;
  const ownsPanel = Boolean(
    panel
    && trigger.id
    && panel.dataset.personalAlgorithmExplanationTriggerId === trigger.id
    && getExplanationTrigger(panel) === trigger
  );
  if (!ownsPanel) {
    trigger.removeAttribute('aria-controls');
    panel = createExplanationPortal(trigger, kind);
  }
  return panel!;
};

const bindExplanationTrigger = (
  trigger: HTMLButtonElement,
  kind: 'native' | 'replacement',
  item: RankedFeedItem,
) => {
  // Assign through onclick rather than a copied DOM marker. YouTube can clone
  // renderer subtrees, which copies data attributes but not event listeners.
  // Reassigning the property is idempotent for a live element and repairs clones.
  delete trigger.dataset.personalAlgorithmExplanationBound;
  trigger.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();

    // Recover lazily as well as during presentation refresh. This closes the
    // window where cleanup removed a body-level portal but the visible card
    // survived long enough to be clicked before the next rerank/refresh.
    const existingPanelId = trigger.getAttribute('aria-controls');
    const existingPanel = existingPanelId ? document.getElementById(existingPanelId) : null;
    const panel = existingPanel ?? ensureExplanationPortalForTrigger(trigger, kind);
    if (!existingPanel) renderExplanationContent(panel, item);

    const opening = panel.hidden;
    if (opening) closeOtherExplanationPanels(panel);
    setExplanationPanelOpen(panel, opening);
  };
};

const whyNodeAccent = (kind: string): { border: string; background: string } => {
  if (kind === 'creator') return { border: '#fb923c', background: 'rgba(124,45,18,.86)' };
  if (kind === 'topic') return { border: '#34d399', background: 'rgba(6,78,59,.86)' };
  if (kind === 'format') return { border: '#a78bfa', background: 'rgba(76,29,149,.86)' };
  if (kind === 'concept' || kind === 'mode') return { border: '#60a5fa', background: 'rgba(30,64,175,.86)' };
  return { border: '#94a3b8', background: 'rgba(51,65,85,.9)' };
};

const renderExplanationContent = (
  container: HTMLElement,
  item: RankedFeedItem,
) => {
  const technicalDetailsOpen = container
    .querySelector<HTMLDetailsElement>('[data-personal-algorithm-technical-details]')
    ?.open === true;
  const previousScrollTop = container.scrollTop;
  const view = buildExplanationViewModel(item);
  container.replaceChildren();
  container.style.padding = '0';
  container.style.overflow = 'auto';

  const shell = document.createElement('div');
  shell.style.cssText = 'display:block;background:#171717;color:#f8fafc;font:500 12px/1.4 Roboto,Arial,sans-serif;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #353535;';
  const identity = document.createElement('div');
  identity.style.cssText = 'min-width:0;';
  const title = document.createElement('div');
  title.textContent = item.title?.trim() || 'This video';
  title.style.cssText = 'font:700 15px/1.25 Roboto,Arial,sans-serif;color:#fff;white-space:normal;';
  identity.appendChild(title);
  if (item.channel_name?.trim()) {
    const creator = document.createElement('div');
    creator.textContent = item.channel_name.trim();
    creator.style.cssText = 'margin-top:3px;color:#cbd5e1;font:500 12px/1.3 Roboto,Arial,sans-serif;';
    identity.appendChild(creator);
  }
  header.appendChild(identity);
  const headerMeta = document.createElement('div');
  headerMeta.style.cssText = 'display:flex;align-items:center;gap:6px;flex:0 0 auto;';
  const categoryLabel = getContentPresentationLabel(item);
  if (categoryLabel) {
    const chip = document.createElement('span');
    chip.textContent = categoryLabel;
    chip.style.cssText = 'padding:4px 8px;border-radius:999px;background:#052e16;color:#86efac;font:700 10px/1.1 Roboto,Arial,sans-serif;';
    headerMeta.appendChild(chip);
  }
  const score = document.createElement('span');
  score.textContent = String(item.score ?? item.explanation?.displayScore ?? 0);
  score.setAttribute('aria-label', view.scoreLine);
  score.style.cssText = 'flex:0 0 auto;padding:5px 9px;border-radius:999px;background:#0f172a;color:#fff;font:700 12px/1 Roboto,Arial,sans-serif;';
  headerMeta.appendChild(score);
  header.appendChild(headerMeta);
  shell.appendChild(header);

  const presentation = document.createElement('div');
  presentation.style.cssText = 'padding:9px 14px;border-bottom:1px solid #303030;background:#101010;color:#cbd5e1;font:600 11px/1.35 Roboto,Arial,sans-serif;';
  const panelKind = container.dataset.personalAlgorithmExplanationPanel === 'replacement'
    ? 'replacement'
    : 'native';
  const sourceLine = document.createElement('div');
  sourceLine.textContent = panelKind === 'replacement'
    ? `Presentation: replaced a YouTube card · Source: ${view.sourceLabel}`
    : 'Presentation: native YouTube card reranked in place · Source: YouTube native page';
  presentation.appendChild(sourceLine);
  if (activeDurableMode) {
    const exactModeMatch = isDurableModeGroundedItem(item, activeDurableMode);
    const provisionalModeMatch = !exactModeMatch
      && isProvisionalDurableModeRelevantItem(item, activeDurableMode);
    const modeLine = document.createElement('div');
    modeLine.style.marginTop = '3px';
    modeLine.textContent = exactModeMatch
      ? `Selected group: ${activeDurableMode.label} · exact graph-grounded match`
      : provisionalModeMatch
        ? `Selected group: ${activeDurableMode.label} · provisional semantic match; graph/history grounding is not available yet`
        : `Selected group: ${activeDurableMode.label} · this item has no selected-group grounding`;
    presentation.appendChild(modeLine);
  }
  if (view.historyMatches.length === 0) {
    const historyLine = document.createElement('div');
    historyLine.style.marginTop = '3px';
    historyLine.textContent = 'History: no retained prior watch/click evidence directly supports this score.';
    presentation.appendChild(historyLine);
  }
  shell.appendChild(presentation);

  const graph = document.createElement('div');
  graph.dataset.personalAlgorithmExplanationGraph = 'true';
  const hasHistory = view.historyMatches.length > 0;
  graph.style.cssText = `position:relative;height:${hasHistory ? 300 : 180}px;margin:0 14px;border-bottom:1px solid #353535;overflow:hidden;`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  graph.appendChild(svg);

  const centerNode = document.createElement('div');
  centerNode.textContent = 'This video';
  centerNode.style.cssText = `position:absolute;left:50%;top:${hasHistory ? 18 : 53}%;transform:translate(-50%,-50%);max-width:150px;padding:8px 16px;border:1px solid #a3a3a3;border-radius:12px;background:#404040;color:#fff;text-align:center;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
  graph.appendChild(centerNode);

  if (hasHistory) {
    const cleanSignalLabel = (value: string): string => (
      value
        .replace(/^Graph path:\s*/i, '')
        .replace(/^[^:]+:\s*/, '')
        .trim()
    );
    const signalLabels = [...new Set(
      view.historyMatches
        .flatMap((match) => match.matchedBy)
        .map(cleanSignalLabel)
        .filter(Boolean),
    )].slice(0, 2);
    if (signalLabels.length === 0) {
      signalLabels.push(...view.miniNodes.slice(1, 3).map((node) => node.label));
    }

    const signalPositions = signalLabels.length === 1
      ? [{ x: 50, y: 47 }]
      : [{ x: 30, y: 47 }, { x: 70, y: 47 }];

    signalLabels.forEach((label, index) => {
      const position = signalPositions[index];
      if (!position) return;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '50');
      line.setAttribute('y1', '23');
      line.setAttribute('x2', String(position.x));
      line.setAttribute('y2', String(position.y - 5));
      line.setAttribute('stroke', '#64748b');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);

      const sourceNode = view.miniNodes.find((node) => node.label.toLowerCase() === label.toLowerCase());
      const accent = whyNodeAccent(sourceNode?.kind ?? 'concept');
      const pill = document.createElement('div');
      pill.textContent = label;
      pill.title = label;
      pill.style.cssText = `position:absolute;left:${position.x}%;top:${position.y}%;transform:translate(-50%,-50%);max-width:38%;padding:7px 10px;border:1px solid ${accent.border};border-radius:11px;background:${accent.background};color:#fff;text-align:center;font:600 11px/1.2 Roboto,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      graph.appendChild(pill);
    });

    const historyHeading = document.createElement('div');
    historyHeading.textContent = 'Past videos supporting this';
    historyHeading.style.cssText = 'position:absolute;left:50%;top:64%;transform:translateX(-50%);color:#94a3b8;font:700 10px/1.2 Roboto,Arial,sans-serif;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;';
    graph.appendChild(historyHeading);

    const visibleHistory = view.historyMatches.slice(0, 3);
    const historyPositions = visibleHistory.length === 1
      ? [{ x: 50, y: 84 }]
      : visibleHistory.length === 2
        ? [{ x: 28, y: 84 }, { x: 72, y: 84 }]
        : [{ x: 18, y: 84 }, { x: 50, y: 84 }, { x: 82, y: 84 }];

    visibleHistory.forEach((match, index) => {
      const position = historyPositions[index];
      if (!position) return;
      const matchedSignals = match.matchedBy
        .map(cleanSignalLabel)
        .filter(Boolean);
      let signalIndex = signalLabels.findIndex((label) => matchedSignals.includes(label));
      if (signalIndex < 0) signalIndex = Math.min(index, signalPositions.length - 1);
      const signalPosition = signalPositions[Math.max(0, signalIndex)] ?? { x: 50, y: 47 };

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(position.x));
      line.setAttribute('y1', String(position.y - 6));
      line.setAttribute('x2', String(signalPosition.x));
      line.setAttribute('y2', String(signalPosition.y + 5));
      line.setAttribute('stroke', '#475569');
      line.setAttribute('stroke-width', '0.9');
      line.setAttribute('stroke-dasharray', '3 2');
      svg.appendChild(line);

      const pill = document.createElement('div');
      pill.textContent = match.title;
      pill.title = match.title;
      pill.style.cssText = `position:absolute;left:${position.x}%;top:${position.y}%;transform:translate(-50%,-50%);max-width:29%;padding:7px 9px;border:1px solid #64748b;border-radius:10px;background:#1e293b;color:#e2e8f0;text-align:center;font:600 10px/1.2 Roboto,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      graph.appendChild(pill);
    });
  } else {
    const positions = [
      { x: 24, y: 28 },
      { x: 76, y: 28 },
      { x: 50, y: 82 },
    ];
    view.miniNodes.slice(1, 4).forEach((node, index) => {
      const position = positions[index];
      if (!position) return;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '50');
      line.setAttribute('y1', '53');
      line.setAttribute('x2', String(position.x));
      line.setAttribute('y2', String(position.y));
      line.setAttribute('stroke', '#64748b');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);

      const accent = whyNodeAccent(node.kind);
      const pill = document.createElement('div');
      pill.textContent = node.label;
      pill.title = node.label;
      pill.style.cssText = `position:absolute;left:${position.x}%;top:${position.y}%;transform:translate(-50%,-50%);max-width:38%;padding:7px 10px;border:1px solid ${accent.border};border-radius:11px;background:${accent.background};color:#fff;text-align:center;font:600 11px/1.2 Roboto,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      graph.appendChild(pill);
    });
  }
  shell.appendChild(graph);

  if (hasHistory) {
    const history = document.createElement('div');
    history.style.cssText = 'padding:10px 14px;border-bottom:1px solid #303030;background:#111827;';
    const heading = document.createElement('div');
    const share = view.historyScoreSharePercent;
    heading.textContent = share == null
      ? 'Past history support'
      : `Past history support · ${share}% of positive score is history-backed`;
    heading.style.cssText = 'font:700 11px/1.2 Roboto,Arial,sans-serif;color:#f8fafc;text-transform:uppercase;letter-spacing:.04em;';
    history.appendChild(heading);

    const note = document.createElement('div');
    note.textContent = 'Scroll to inspect retained prior videos. This is scorer attribution, not a probability estimate.';
    note.style.cssText = 'margin-top:4px;color:#94a3b8;font:500 10px/1.3 Roboto,Arial,sans-serif;';
    history.appendChild(note);

    const historyList = document.createElement('div');
    historyList.style.cssText = 'max-height:150px;margin-top:6px;overflow-y:auto;overscroll-behavior:contain;padding-right:4px;';
    for (const match of view.historyMatches) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:8px 0;border-top:1px solid #263244;';
      const title = document.createElement('div');
      title.textContent = match.title;
      title.style.cssText = 'color:#e2e8f0;font:600 11px/1.3 Roboto,Arial,sans-serif;white-space:normal;';
      row.appendChild(title);
      const meta = document.createElement('div');
      const matchedByLabels = match.matchedBy
        .map((label) => label.replace(/^[^:]+:\s*/, '').trim())
        .filter(Boolean)
        .filter((label, index, labels) => (
          labels.findIndex((candidate) => candidate.toLowerCase() === label.toLowerCase()) === index
        ))
        .slice(0, 3);
      const matchedBy = matchedByLabels.join(' · ');
      meta.textContent = [
        match.interaction === 'watched' ? 'Watched before' : match.interaction,
        matchedBy ? `supports via ${matchedBy}` : null,
      ].filter(Boolean).join(' · ');
      meta.style.cssText = 'margin-top:2px;color:#94a3b8;font:500 10px/1.3 Roboto,Arial,sans-serif;';
      row.appendChild(meta);
      historyList.appendChild(row);
    }
    history.appendChild(historyList);
    shell.appendChild(history);
  }

  if (view.pathLines.length > 0) {
    const reasons = document.createElement('div');
    reasons.style.cssText = 'padding:10px 14px 8px;border-bottom:1px solid #303030;background:#141414;';
    const heading = document.createElement('div');
    heading.textContent = 'Why it matched';
    heading.style.cssText = 'font:700 11px/1.2 Roboto,Arial,sans-serif;color:#f8fafc;text-transform:uppercase;letter-spacing:.04em;';
    reasons.appendChild(heading);
    for (const pathLine of view.pathLines.slice(0, 2)) {
      const row = document.createElement('div');
      row.textContent = pathLine.replace(/^Graph path:\s*/i, '');
      row.style.cssText = 'margin-top:6px;color:#cbd5e1;font:500 11px/1.35 Roboto,Arial,sans-serif;white-space:normal;';
      reasons.appendChild(row);
    }
    shell.appendChild(reasons);
  }

  const contributions = document.createElement('div');
  contributions.style.cssText = 'padding:0 14px;';
  if (view.contributions.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:10px 0;color:#94a3b8;border-bottom:1px solid #303030;font:500 11px/1.4 Roboto,Arial,sans-serif;';
    empty.textContent = activeDurableMode && isProvisionalDurableModeRelevantItem(item, activeDurableMode)
      ? 'No exact editable graph contribution is available yet. This replacement currently qualifies through provisional semantic mode matching.'
      : 'No exact editable graph contribution is available for this item yet.';
    contributions.appendChild(empty);
  }
  for (const contribution of view.contributions) {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) auto minmax(150px,auto);gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #303030;';
    const label = document.createElement('div');
    label.style.cssText = 'min-width:0;font-weight:700;color:#f8fafc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const accent = document.createElement('span');
    const nodeKind = view.miniNodes.find((node) => node.label === contribution.shortLabel)?.kind ?? contribution.kind;
    const accentStyle = whyNodeAccent(nodeKind);
    accent.style.cssText = `display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;background:${accentStyle.border};`;
    label.appendChild(accent);
    label.append(document.createTextNode(contribution.label));
    row.appendChild(label);

    const value = document.createElement('strong');
    value.textContent = `${contribution.value > 0 ? '+' : ''}${contribution.value}`;
    value.style.cssText = 'color:#e2e8f0;font-variant-numeric:tabular-nums;';
    row.appendChild(value);

    const actionable = Boolean(
      contribution.targetKind
      && contribution.targetId,
    );
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:4px;align-items:center;justify-content:flex-end;flex-wrap:wrap;';
    if (!actionable) {
      const inspect = document.createElement('button');
      inspect.type = 'button';
      inspect.textContent = 'Inspect';
      inspect.disabled = true;
      inspect.title = 'This contribution is aggregated or has no direct graph target.';
      inspect.style.cssText = 'padding:3px 9px;border:1px solid #64748b;border-radius:999px;background:transparent;color:#f8fafc;font:600 11px/1.2 Roboto,Arial,sans-serif;opacity:.5;';
      actions.appendChild(inspect);
    } else {
      const controlOptions = [
        { label: 'Prefer', action: 'prefer' as const, title: 'Recommend more from this exact graph term.' },
        { label: 'Reduce', action: 'reduce' as const, title: 'Recommend less from this exact graph term.' },
        { label: 'Mute', action: 'mute' as const, title: 'Suppress candidates matching this exact graph term.' },
      ];
      for (const option of controlOptions) {
        const control = document.createElement('button');
        control.type = 'button';
        control.textContent = option.label;
        const suggested = contribution.actionLabel === option.label;
        control.title = `${option.title} The edit is revisioned and can be undone in Options.`;
        control.style.cssText = `padding:3px 7px;border:${suggested ? '2px' : '1px'} solid #64748b;border-radius:999px;background:${suggested ? 'rgba(30,64,175,.35)' : 'transparent'};color:#f8fafc;font:${suggested ? '700' : '600'} 10px/1.2 Roboto,Arial,sans-serif;cursor:pointer;`;
        control.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const siblings = Array.from(actions.querySelectorAll<HTMLButtonElement>('button'));
          siblings.forEach((button) => { button.disabled = true; });
          const originalLabel = control.textContent;
          control.textContent = 'Applying…';
          void chrome.runtime.sendMessage({
            type: 'PERSONAL_ALGORITHM_SET_CONTROL',
            payload: {
              targetKind: contribution.targetKind,
              targetId: contribution.targetId,
              action: option.action,
            },
          }).then((response: { ok?: boolean; error?: string }) => {
            siblings.forEach((button) => { button.disabled = false; });
            if (!response?.ok) {
              control.textContent = originalLabel;
              control.title = response?.error ?? 'Unable to update this graph control.';
              return;
            }
            siblings.forEach((button) => {
              if (button !== control && button.textContent?.endsWith(' ✓')) {
                button.textContent = button.textContent.slice(0, -2);
              }
            });
            control.textContent = `${option.label} ✓`;
            control.title = 'Saved as a revisioned graph control. Choose another direction here or use Options to undo/restore.';
          }).catch((error) => {
            siblings.forEach((button) => { button.disabled = false; });
            control.textContent = originalLabel;
            control.title = error instanceof Error ? error.message : 'Unable to update this graph control.';
          });
        });
        actions.appendChild(control);
      }
    }
    row.appendChild(actions);
    contributions.appendChild(row);
  }
  shell.appendChild(contributions);

  if (item.external_id) {
    const itemFeedback = document.createElement('div');
    itemFeedback.style.cssText = 'padding:10px 14px;border-bottom:1px solid #303030;background:#121212;';
    const feedbackLabel = document.createElement('div');
    feedbackLabel.textContent = 'Video-level feedback';
    feedbackLabel.style.cssText = 'margin-bottom:7px;color:#cbd5e1;font:700 10px/1.2 Roboto,Arial,sans-serif;text-transform:uppercase;letter-spacing:.04em;';
    itemFeedback.appendChild(feedbackLabel);
    const feedbackControls = document.createElement('div');
    feedbackControls.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    const feedbackOptions = [
      { label: 'More like this', eventType: 'more_like_this' as const },
      { label: 'Less like this', eventType: 'not_interested' as const },
    ];
    for (const option of feedbackOptions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.label;
      button.style.cssText = 'padding:5px 9px;border:1px solid #64748b;border-radius:999px;background:transparent;color:#f8fafc;font:600 10px/1.2 Roboto,Arial,sans-serif;cursor:pointer;';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const original = button.textContent;
        button.disabled = true;
        button.textContent = 'Saving…';
        void chrome.runtime.sendMessage({
          type: EXTENSION_MESSAGE_TYPES.FEEDBACK,
          payload: { contentItemId: item.external_id, eventType: option.eventType },
        }).then((response: { ok?: boolean; error?: string }) => {
          button.disabled = false;
          if (!response?.ok) {
            button.textContent = original;
            button.title = response?.error ?? 'Unable to save feedback.';
            return;
          }
          button.textContent = `${option.label} ✓`;
          button.title = 'Saved as explicit video feedback and applied to the next rank.';
        }).catch((error) => {
          button.disabled = false;
          button.textContent = original;
          button.title = error instanceof Error ? error.message : 'Unable to save feedback.';
        });
      });
      feedbackControls.appendChild(button);
    }
    itemFeedback.appendChild(feedbackControls);
    const feedbackNote = document.createElement('div');
    feedbackNote.textContent = 'Use these when no exact graph term exists yet. Video feedback affects ranking; graph-term controls remain separate.';
    feedbackNote.style.cssText = 'margin-top:6px;color:#94a3b8;font:500 10px/1.35 Roboto,Arial,sans-serif;';
    itemFeedback.appendChild(feedbackNote);
    shell.appendChild(itemFeedback);
  }

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:10px 14px 12px;';
  const details = document.createElement('details');
  details.dataset.personalAlgorithmTechnicalDetails = 'true';
  details.open = technicalDetailsOpen;
  const summary = document.createElement('summary');
  summary.textContent = 'Technical details';
  summary.style.cssText = 'cursor:pointer;color:#cbd5e1;font-weight:600;';
  details.appendChild(summary);
  const detailBody = document.createElement('div');
  detailBody.style.cssText = 'margin-top:8px;padding:8px 10px;border-radius:8px;background:#0f172a;color:#cbd5e1;font-size:11px;overflow-wrap:anywhere;';
  const scoreLine = document.createElement('div');
  scoreLine.textContent = view.scoreLine;
  detailBody.appendChild(scoreLine);
  if (view.traceId) {
    const trace = document.createElement('div');
    trace.textContent = `Trace ${view.traceId}`;
    trace.style.marginTop = '4px';
    detailBody.appendChild(trace);
  }
  if (view.acquisitionLine) {
    const acquired = document.createElement('div');
    acquired.textContent = view.acquisitionLine;
    acquired.style.marginTop = '4px';
    detailBody.appendChild(acquired);
  }
  for (const pathLine of view.pathLines) {
    const path = document.createElement('div');
    path.textContent = pathLine;
    path.style.marginTop = '4px';
    detailBody.appendChild(path);
  }
  details.appendChild(detailBody);
  footer.appendChild(details);

  shell.appendChild(footer);

  container.appendChild(shell);
  container.scrollTop = previousScrollTop;
};

const ensureNativeExplanationControl = (
  card: HTMLElement,
  item: RankedFeedItem,
) => {
  const host = card.querySelector<HTMLElement>(
    '#thumbnail, ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail',
  ) ?? card;
  const computedPosition = getComputedStyle(host).position;
  if (computedPosition === 'static') {
    host.style.position = 'relative';
    host.dataset.personalAlgorithmPositionPatched = 'true';
  }
  if (getComputedStyle(card).position === 'static') {
    card.style.position = 'relative';
    card.dataset.personalAlgorithmPositionPatched = 'true';
  }

  let why = host.querySelector<HTMLButtonElement>('[data-personal-algorithm-explanation="native"]');
  if (!why) {
    why = document.createElement('button');
    why.type = 'button';
    why.dataset.personalAlgorithmExplanation = 'native';
    why.textContent = 'Why this?';
    why.setAttribute('aria-label', 'Why MyAlgo scored this video');
    why.setAttribute('aria-expanded', 'false');
    why.style.cssText = 'position:absolute;z-index:1000;top:8px;right:8px;display:inline-flex;align-items:center;justify-content:center;padding:6px 10px;border-radius:999px;border:1px solid rgba(148,163,184,.75);background:rgba(15,23,42,.94);color:#fff;font:700 11px/1.2 sans-serif;cursor:pointer;appearance:none;-webkit-appearance:none;box-shadow:0 2px 8px rgba(0,0,0,.35);';
    host.appendChild(why);
  }
  const panel = ensureExplanationPortalForTrigger(why, 'native');
  bindExplanationTrigger(why, 'native', item);

  why.dataset.personalAlgorithmTraceId = item.traceId ?? '';
  renderExplanationContent(panel, item);
};

const createThumbnail = (
  item: RankedFeedItem,
  aspectRatio = youtubeConnector.presentation.horizontalAspectRatio,
): HTMLElement => {
  const media = item.thumbnail_url ? document.createElement('img') : document.createElement('div');
  media.dataset.personalAlgorithmThumbnail = 'true';
  if (media instanceof HTMLImageElement) {
    media.src = item.thumbnail_url ?? '';
    media.alt = '';
    media.loading = 'lazy';
  } else {
    media.setAttribute('aria-hidden', 'true');
    media.textContent = 'Thumbnail unavailable';
    media.style.cssText = `display:flex;width:100%;aspect-ratio:${aspectRatio};align-items:center;justify-content:center;border-radius:10px;background:var(--yt-spec-10-percent-layer, #272727);color:var(--yt-spec-text-secondary, #aaa);font:500 12px/1.3 Roboto,Arial,sans-serif;`;
    return media;
  }
  media.style.cssText = `display:block;width:100%;aspect-ratio:${aspectRatio};object-fit:cover;border-radius:10px;background:var(--yt-spec-10-percent-layer, #272727);`;
  return media;
};

const createReplacementCard = (
  item: RankedFeedItem,
  target: HTMLElement,
  slotId: string,
  sourceVideoId: string,
  generation: number,
): HTMLElement => {
  const card = document.createElement('article');
  const targetWidth = Number(target.dataset.personalAlgorithmSlotWidth ?? 0);
  const targetHeight = Number(target.dataset.personalAlgorithmSlotHeight ?? 0);
  const targetFlags = getVideoSourceFlags(target);
  const aspectRatio = targetFlags.is_short
    ? youtubeConnector.presentation.verticalAspectRatio
    : youtubeConnector.presentation.horizontalAspectRatio;

  const metadata = getReplacementPresentationMetadata(
    { slot: { slotId, sourceVideoId }, item },
    generation,
    activeMode,
  );
  const displayMetadata = getReplacementTextMetadata(item);
  card.dataset.personalAlgorithmReplacement = 'true';
  card.dataset.personalAlgorithmVideoId = metadata.replacementVideoId;
  card.dataset.personalAlgorithmTraceId = metadata.traceId;
  card.dataset.personalAlgorithmReplacementSlot = metadata.slotId;
  card.dataset.personalAlgorithmReplacementSourceVideoId = metadata.sourceVideoId;
  card.dataset.personalAlgorithmReplacementGeneration = String(metadata.generation);
  card.dataset.personalAlgorithmReplacementBindingRevision = String(replacementBindingRevision);
  card.dataset.personalAlgorithmReplacementInvalidationReason = lastReplacementInvalidationReason;
  card.dataset.personalAlgorithmReplacementMode = metadata.mode;
  const modeGrounding = item.explanation?.modeGrounding;
  if (modeGrounding) {
    card.dataset.personalAlgorithmReplacementModeId = modeGrounding.modeId;
    card.dataset.personalAlgorithmReplacementModeRevision = String(modeGrounding.modeRevision);
  }
  card.dataset.personalAlgorithmReplacementScore = String(metadata.score);
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `MyAlgo replacement: ${item.title ?? 'Recommended video'}`);
  card.style.cssText = `display:block;width:100%;max-width:${targetWidth > 0 ? `${targetWidth}px` : '100%'};height:${targetHeight > 0 ? `${targetHeight}px` : 'auto'};min-width:0;align-self:start;box-sizing:border-box;position:relative;overflow:hidden;contain:layout paint;color:var(--yt-spec-text-primary, #0f0f0f);font-family:Roboto,Arial,sans-serif;`;

  const replacementBadge = document.createElement('span');
  replacementBadge.dataset.personalAlgorithmBadge = 'true';
  const contentLabel = getContentPresentationLabel(item);
  const replacementSourceLabel = getCandidateAcquisitionLabel(item);
  replacementBadge.textContent = contentLabel
    ? `${contentLabel} · MyAlgo replaced · ${replacementSourceLabel} · ${metadata.score}`
    : `MyAlgo replaced · ${replacementSourceLabel} · ${metadata.score}`;
  replacementBadge.style.cssText = 'position:absolute;z-index:30;top:8px;left:8px;max-width:calc(100% - 104px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 8px;border-radius:999px;background:#0f172a;color:#fff;font:700 11px/1.2 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;';
  card.appendChild(replacementBadge);

  const link = document.createElement('a');
  link.href = youtubeConnector.getCanonicalUrl(item.external_id ?? '');
  link.dataset.personalAlgorithmVideoId = item.external_id ?? '';
  link.setAttribute('aria-label', item.title ?? 'MyAlgo recommended video');
  link.style.cssText = 'display:block;color:inherit;text-decoration:none;min-width:0;';
  link.appendChild(createThumbnail(item, aspectRatio));

  const videoMeta = document.createElement('div');
  videoMeta.dataset.personalAlgorithmVideoMetadata = 'true';
  videoMeta.style.cssText = 'display:block;margin-top:10px;min-width:0;padding:0 2px;';

  const title = document.createElement('div');
  title.dataset.personalAlgorithmTitle = 'true';
  title.textContent = displayMetadata.title;
  title.style.cssText = 'display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--yt-spec-text-primary,#f1f1f1);font-size:16px;font-weight:600;line-height:22px;white-space:normal;';
  videoMeta.appendChild(title);

  const channel = document.createElement('div');
  channel.dataset.personalAlgorithmCreator = 'true';
  channel.textContent = displayMetadata.creator;
  channel.style.cssText = 'display:block;margin-top:4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--yt-spec-text-secondary,#aaa);font-size:14px;line-height:20px;';
  videoMeta.appendChild(channel);
  link.appendChild(videoMeta);
  card.appendChild(link);

  const meta = document.createElement('div');
  meta.dataset.personalAlgorithmReplacementSummary = 'true';
  meta.textContent = contentLabel
    ? `${contentLabel} · MyAlgo · ${item.score ?? 0}/100`
    : `MyAlgo · ${item.score ?? 0}/100`;
  meta.style.cssText = 'margin-top:7px;color:var(--yt-spec-text-secondary,#aaa);font-size:12px;line-height:17px;font-weight:600;';
  card.appendChild(meta);

  const why = document.createElement('button');
  why.type = 'button';
  why.dataset.personalAlgorithmExplanation = 'true';
  why.dataset.personalAlgorithmTraceId = item.traceId ?? '';
  why.textContent = 'Why this?';
  why.setAttribute('aria-label', 'Why MyAlgo showed this replacement');
  // Keep explanation affordance inside the preserved native-card footprint.
  // Replacement cards intentionally use a fixed native slot height + overflow
  // clipping, so a normal-flow control appended below metadata can disappear.
  why.style.cssText = 'position:absolute;z-index:35;top:8px;right:8px;display:inline-flex;align-items:center;justify-content:center;padding:6px 10px;border-radius:999px;border:1px solid rgba(148,163,184,.75);background:rgba(15,23,42,.94);color:#fff;font:700 11px/1.2 sans-serif;cursor:pointer;appearance:none;-webkit-appearance:none;box-shadow:0 2px 8px rgba(0,0,0,.35);';
  why.setAttribute('aria-expanded', 'false');
  card.appendChild(why);
  const explanation = ensureExplanationPortalForTrigger(why, 'replacement');
  renderExplanationContent(explanation, item);
  bindExplanationTrigger(why, 'replacement', item);

  return card;
};

const refreshReplacementCardPresentation = (
  card: HTMLElement,
  item: RankedFeedItem,
  target: HTMLElement,
  slotId: string,
  sourceVideoId: string,
  generation: number,
) => {
  const metadata = getReplacementPresentationMetadata(
    { slot: { slotId, sourceVideoId }, item },
    generation,
    activeMode,
  );
  const displayMetadata = getReplacementTextMetadata(item);
  const contentLabel = getContentPresentationLabel(item);

  card.dataset.personalAlgorithmVideoId = metadata.replacementVideoId;
  card.dataset.personalAlgorithmTraceId = metadata.traceId;
  card.dataset.personalAlgorithmReplacementSlot = metadata.slotId;
  card.dataset.personalAlgorithmReplacementSourceVideoId = metadata.sourceVideoId;
  card.dataset.personalAlgorithmReplacementGeneration = String(metadata.generation);
  card.dataset.personalAlgorithmReplacementBindingRevision = String(replacementBindingRevision);
  card.dataset.personalAlgorithmReplacementInvalidationReason = lastReplacementInvalidationReason;
  card.dataset.personalAlgorithmReplacementMode = metadata.mode;
  card.dataset.personalAlgorithmReplacementScore = String(metadata.score);
  const modeGrounding = item.explanation?.modeGrounding;
  if (modeGrounding) {
    card.dataset.personalAlgorithmReplacementModeId = modeGrounding.modeId;
    card.dataset.personalAlgorithmReplacementModeRevision = String(modeGrounding.modeRevision);
  } else {
    delete card.dataset.personalAlgorithmReplacementModeId;
    delete card.dataset.personalAlgorithmReplacementModeRevision;
  }
  card.setAttribute('aria-label', `MyAlgo replacement: ${item.title ?? 'Recommended video'}`);

  const targetWidth = Number(target.dataset.personalAlgorithmSlotWidth ?? 0);
  const targetHeight = Number(target.dataset.personalAlgorithmSlotHeight ?? 0);
  card.style.width = '100%';
  card.style.maxWidth = targetWidth > 0 ? `${targetWidth}px` : '100%';
  card.style.height = targetHeight > 0 ? `${targetHeight}px` : 'auto';
  card.style.overflow = 'hidden';
  card.style.contain = 'layout paint';

  const badge = card.querySelector<HTMLElement>('[data-personal-algorithm-badge]');
  if (badge) {
    const replacementSourceLabel = getCandidateAcquisitionLabel(item);
    badge.textContent = contentLabel
      ? `${contentLabel} · MyAlgo replaced · ${replacementSourceLabel} · ${metadata.score}`
      : `MyAlgo replaced · ${replacementSourceLabel} · ${metadata.score}`;
  }

  const link = card.querySelector<HTMLAnchorElement>('a[data-personal-algorithm-video-id]');
  if (link) {
    link.href = youtubeConnector.getCanonicalUrl(item.external_id ?? '');
    link.dataset.personalAlgorithmVideoId = item.external_id ?? '';
    link.setAttribute('aria-label', item.title ?? 'MyAlgo recommended video');

    const currentThumbnail = link.querySelector<HTMLElement>(
      '[data-personal-algorithm-thumbnail]',
    );
    const wantsImage = Boolean(item.thumbnail_url);
    const hasImage = currentThumbnail instanceof HTMLImageElement;
    if (currentThumbnail && wantsImage === hasImage) {
      if (currentThumbnail instanceof HTMLImageElement) {
        currentThumbnail.src = item.thumbnail_url ?? '';
      }
    } else if (currentThumbnail) {
      const targetFlags = getVideoSourceFlags(target);
      const aspectRatio = targetFlags.is_short
        ? youtubeConnector.presentation.verticalAspectRatio
        : youtubeConnector.presentation.horizontalAspectRatio;
      currentThumbnail.replaceWith(createThumbnail(item, aspectRatio));
    }
  }
  const title = card.querySelector<HTMLElement>('[data-personal-algorithm-title]');
  if (title) title.textContent = displayMetadata.title;
  const creator = card.querySelector<HTMLElement>('[data-personal-algorithm-creator]');
  if (creator) creator.textContent = displayMetadata.creator;
  const summary = card.querySelector<HTMLElement>('[data-personal-algorithm-replacement-summary]');
  if (summary) {
    summary.textContent = contentLabel
      ? `${contentLabel} · MyAlgo · ${item.score ?? 0}/100`
      : `MyAlgo · ${item.score ?? 0}/100`;
  }

  const why = card.querySelector<HTMLButtonElement>('[data-personal-algorithm-explanation]');
  if (!why) return;
  why.dataset.personalAlgorithmTraceId = item.traceId ?? '';

  // Replacement cards can survive while their body-level portal is removed by
  // cleanup/navigation churn. Revalidate ownership and rebind every refresh
  // instead of assuming aria-controls still points at a live panel.
  const explanation = ensureExplanationPortalForTrigger(why, 'replacement');
  bindExplanationTrigger(why, 'replacement', item);
  renderExplanationContent(explanation, item);
};

const clearLegacyRecommendationShelf = () => {
  document.querySelector('[data-personal-algorithm-shelf]')?.remove();
};

const getVideoTitle = (element: HTMLElement) => {
  const titleNode = element.querySelector<HTMLElement>(youtubeConnector.titleSelectors.join(','));

  const directTitle =
    titleNode?.getAttribute('title')
    ?? titleNode?.getAttribute('aria-label')
    ?? titleNode?.textContent
    ?? '';

  if (normalizeText(directTitle)) {
    return normalizeText(directTitle);
  }

  const linkedTitle = Array.from(element.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))
    .map((link) => youtubeConnector.getLinkTitle({
      title: link.getAttribute('title'),
      ariaLabel: link.getAttribute('aria-label'),
      textContent: link.textContent,
    }))
    .map((value) => normalizeText(value))
    .find(Boolean);

  if (linkedTitle) {
    return linkedTitle;
  }

  const fallback = normalizeText(element.textContent ?? '').slice(0, 140);
  return fallback;
};

const getVideoId = (element: HTMLElement) => {
  const links = Array.from(element.querySelectorAll<HTMLAnchorElement>(`a#thumbnail[href], a#video-title-link[href], ${videoLinkSelector}`));
  const videoId = links
    .map((link) => youtubeConnector.getExternalId(link.href))
    .find(Boolean);
  return videoId ?? `title:${getVideoTitle(element)}`;
};

const getVideoSourceFlags = (element: HTMLElement) => {
  const href = Array.from(element.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))[0]?.href ?? '';
  return youtubeConnector.getSourceFlags(href);
};

const sendActivity = (externalId: string, eventType: 'opened' | 'revisited') => {
  if (!extensionEnabled || !externalId || externalId.startsWith('title:')) return;
  safeSendMessage({
    type: 'ACTIVITY',
    payload: { externalId, eventType: youtubeConnector.mapPresentationEvent(eventType) },
  });
};

const getCardForVideoLink = (link: HTMLAnchorElement) => {
  if (isMyAlgoInjectedElement(link) || isYouTubeCommentSurfaceElement(link)) return null;
  const knownCard = link.closest(videoSelectors.join(',')) as HTMLElement | null;
  if (knownCard) return knownCard;

  let current: HTMLElement | null = link.parentElement;
  for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
    const hasVideoLink = current.querySelector(videoLinkSelector);
    const hasTitleNode = current.querySelector('#video-title, #video-title-link, yt-formatted-string#video-title, a[title], a[aria-label]');
    const text = normalizeText(current.textContent ?? '');
    if (hasVideoLink && hasTitleNode && text.length > 12 && text.length < 1200) {
      return current;
    }
  }

  return link.parentElement;
};

const getChannelName = (element: HTMLElement) => normalizeText(
  element.querySelector('#channel-name, ytd-channel-name, .ytd-channel-name')?.textContent ?? '',
);

const getVideoElements = (diagnoseInjected = false) => {
  const knownElements = Array.from(document.querySelectorAll(videoSelectors.join(','))) as HTMLElement[];
  const linkElements = Array.from(document.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))
    .map(getCardForVideoLink)
    .filter((element): element is HTMLElement => Boolean(element));
  const uniqueElements = Array.from(new Set([...knownElements, ...linkElements]));
  const nativeElements = keepOutermostElements(
    uniqueElements.filter((element) => (
      !isMyAlgoInjectedElement(element)
      && !isYouTubeCommentSurfaceElement(element)
    )),
    (parent, child) => parent.contains(child),
  );
  const skippedInjected = uniqueElements.length - uniqueElements.filter(
    (element) => !isMyAlgoInjectedElement(element),
  ).length;
  if (diagnoseInjected && skippedInjected > 0) {
    console.info('[MyAlgo] skipped injected candidate elements', { count: skippedInjected });
  }
  return nativeElements;
};

type NativeCardSnapshotEntry = {
  element: HTMLElement;
  id: string;
  title: string;
  channelName: string;
  thumbnailUrl: string | null;
  flags: ReturnType<typeof getVideoSourceFlags>;
  rect: DOMRectReadOnly | null;
};

type NativeCardSnapshot = {
  cards: NativeCardSnapshotEntry[];
  cardByElement: Map<HTMLElement, NativeCardSnapshotEntry>;
};

const createNativeCardSnapshot = (
  options: { diagnoseInjected?: boolean; measureGeometry?: boolean } = {},
): NativeCardSnapshot => {
  const elements = getVideoElements(options.diagnoseInjected === true);
  const cards = elements.map((element) => ({
    element,
    id: getVideoId(element),
    title: getVideoTitle(element),
    channelName: getChannelName(element),
    thumbnailUrl: element.querySelector<HTMLImageElement>('img[src]')?.src ?? null,
    flags: getVideoSourceFlags(element),
    rect: options.measureGeometry === true ? element.getBoundingClientRect() : null,
  }));
  return {
    cards,
    cardByElement: new Map(cards.map((card) => [card.element, card])),
  };
};

const getPageSourceKind = (): 'subscription' | 'discovery' | 'liked' | null => {
  const path = location.pathname.toLowerCase();
  if (path === '/feed/subscriptions') return 'subscription';
  if (path === '/playlist' && new URLSearchParams(location.search).get('list') === 'LL') return 'liked';
  if (path === '/' || path === '/results' || path === '/watch' || path.startsWith('/shorts')) return 'discovery';
  return null;
};

const collectCandidates = () => {
  const sourceKind = getPageSourceKind();
  const cardCandidates = createNativeCardSnapshot({ diagnoseInjected: true }).cards
    .map((card) => ({
      external_id: card.id,
      title: card.title,
      channel_name: card.channelName,
      thumbnail_url: card.thumbnailUrl,
      source_kind: sourceKind,
      ...card.flags,
    }))
    .filter((candidate) => candidate.title)
    .slice(0, youtubeConnector.presentation.candidateLimit);

  const anchorCandidates = Array.from(document.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))
    .filter((link) => !isMyAlgoInjectedElement(link) && !isYouTubeCommentSurfaceElement(link))
    .map((link) => ({
      external_id: youtubeConnector.getExternalId(link.href) ?? '',
      title: normalizeText(youtubeConnector.getLinkTitle({
        title: link.getAttribute('title'),
        ariaLabel: link.getAttribute('aria-label'),
        textContent: link.textContent,
      })),
      channel_name: '',
      source_kind: sourceKind,
      ...youtubeConnector.getSourceFlags(link.href),
    }))
    .filter((candidate) => candidate.external_id && candidate.title);

  const candidates = dedupeCandidatesById([...cardCandidates, ...anchorCandidates])
    .slice(0, youtubeConnector.presentation.candidateLimit);

  if (candidates.length === 0) {
    console.info('Personal Algorithm found no video cards', {
      watchLinks: document.querySelectorAll('a[href*="/watch?v="]').length,
      shortsLinks: document.querySelectorAll('a[href*="/shorts/"]').length,
      knownCards: document.querySelectorAll(videoSelectors.join(',')).length,
      url: location.href,
    });
  }

  return candidates;
};

const observeHistoryPage = () => {
  if (!extensionEnabled || !isCurrentInstance() || !isYouTubeHistoryPage(location.pathname)) return;

  void safeStorageGet([STORAGE_KEYS.HISTORY_OBSERVATION_ENABLED]).then((result) => {
    if (!extensionEnabled || result[STORAGE_KEYS.HISTORY_OBSERVATION_ENABLED] !== true) return;
    const observation = collectHistoryEvidenceFromDom(document);
    console.info('Personal Algorithm history extraction diagnostic', {
      observedAt: observation.evidence[0]?.observedAt ?? new Date().toISOString(),
      scrollTop: Math.round(window.scrollY),
      viewportHeight: Math.round(window.innerHeight),
      scrollHeight: Math.round(document.documentElement.scrollHeight),
      metrics: observation.metrics,
    });
    if (observation.evidence.length === 0) return;
    safeSendMessage({
      type: EXTENSION_MESSAGE_TYPES.HISTORY_OBSERVATION,
      payload: observation,
    });
  });
};

const scheduleHistoryObservation = () => {
  if (historyObservationTimer !== undefined) window.clearTimeout(historyObservationTimer);
  historyObservationTimer = window.setTimeout(() => {
    historyObservationTimer = undefined;
    observeHistoryPage();
  }, 400);
};

const observeHomeRecommendations = () => {
  if (!extensionEnabled || !isCurrentInstance() || !isYouTubeHomePage(location.pathname)) return;
  safeStorageGet([STORAGE_KEYS.HOME_OBSERVATION_ENABLED]).then((result) => {
    if (!extensionEnabled || !isCurrentInstance() || result[STORAGE_KEYS.HOME_OBSERVATION_ENABLED] !== true) return;
    const observation = collectRecommendationObservationsFromDom(document);
    safeSendMessage({
      type: EXTENSION_MESSAGE_TYPES.RECOMMENDATION_OBSERVATION,
      payload: observation,
    });
  });
};

const scheduleHomeRecommendationObservation = () => {
  if (recommendationObservationTimer !== undefined) window.clearTimeout(recommendationObservationTimer);
  recommendationObservationTimer = window.setTimeout(() => {
    recommendationObservationTimer = undefined;
    observeHomeRecommendations();
  }, 400);
};

const getFeedLayoutItem = (element: HTMLElement): HTMLElement | null => {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 10; depth += 1) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return current;
    if (parent.id === 'contents' && parent.closest('ytd-rich-grid-renderer')) {
      return current;
    }
    current = parent;
  }
  return null;
};

const syncSourceFilteredContainers = () => {
  document.querySelectorAll<HTMLElement>(
    '[data-personal-algorithm-source-shelf-hidden], [data-personal-algorithm-source-row-hidden]',
  ).forEach((container) => {
    container.style.removeProperty('display');
    delete container.dataset.personalAlgorithmSourceShelfHidden;
    delete container.dataset.personalAlgorithmSourceRowHidden;
  });

  const hideShelf = (shelf: HTMLElement, reason: 'shorts' | 'playables') => {
    const structuralHost = shelf.closest<HTMLElement>(
      'ytd-rich-section-renderer, ytd-item-section-renderer',
    );
    const layoutItem = getFeedLayoutItem(structuralHost ?? shelf);
    if (layoutItem) {
      layoutItem.dataset.personalAlgorithmSourceLayoutHidden = reason;
      layoutItem.style.setProperty('display', 'none', 'important');
    }
    if (structuralHost) {
      structuralHost.dataset.personalAlgorithmSourceSectionHidden = reason;
      structuralHost.style.setProperty('display', 'none', 'important');
      return;
    }
    shelf.dataset.personalAlgorithmSourceShelfHidden = reason;
    shelf.style.setProperty('display', 'none', 'important');
  };

  document.querySelectorAll<HTMLElement>(
    'ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytd-shelf-renderer',
  ).forEach((shelf) => {
    const reason = getSourceShelfHideReason({
      heading: shelf.querySelector<HTMLElement>(
        '#title, #title-container, h2, h3, yt-formatted-string',
      )?.textContent ?? '',
      hasShortsLink: Boolean(
        shelf.querySelector('a[href^="/shorts/"], a[href*="youtube.com/shorts/"]'),
      ),
      hasPlayableLink: Boolean(
        shelf.querySelector(
          'a[href*="/playables"], a[href*="playables?"], a[href*="/game/"]',
        ),
      ),
    }, sourceFilters);
    if (reason) hideShelf(shelf, reason);
  });

  // YouTube can retain an otherwise-empty rich-grid row after every card in it
  // has been source-filtered. Collapse only rows whose native card renderers are
  // all currently hidden by MyAlgo, so ordinary native layout remains untouched.
  document.querySelectorAll<HTMLElement>('ytd-rich-grid-row').forEach((row) => {
    const cards = Array.from(row.querySelectorAll<HTMLElement>('ytd-rich-item-renderer'));
    if (cards.length === 0) return;
    const everyCardHidden = cards.every((card) => (
      card.style.getPropertyValue('display') === 'none'
      && card.dataset.personalAlgorithmScore === 'source_filter'
    ));
    if (!everyCardHidden) return;
    row.dataset.personalAlgorithmSourceRowHidden = 'true';
    row.style.setProperty('display', 'none', 'important');
  });
};

const applyRankedFeed = (
  snapshot: NativeCardSnapshot = createNativeCardSnapshot({ measureGeometry: true }),
) => {
  if (!isCurrentInstance()) return;
  const feedById = new Map(cachedFeed.map((item) => [item.external_id, item]));
  const feedByTitle = new Map(cachedFeed.map((item) => [normalizeText(item.title ?? ''), item]));
  const rankById = new Map(cachedFeed.map((item, index) => [item.external_id, index]));
  const nativeCards = snapshot.cards;
  const knownElements = nativeCards.map((card) => card.element);
  const replacementMinimumScore = youtubeConnector.presentation.replacementMinimumScore
    * (1 - feedReplacementPercent / 100);
  const homePage = isYouTubeHomePage(location.pathname);
  const allNativeIds = nativeCards
    .map((card) => card.id)
    .filter((id) => id && !id.startsWith('title:'));
  const nativeIds = new Set(allNativeIds);
  const currentRouteKey = getRouteKey();
  const retainedBindingItems = [...stableReplacementBySourceId.values()]
    .filter((binding) => (
      binding.routeKey === currentRouteKey
      && binding.bindingRevision === replacementBindingRevision
    ))
    .map((binding) => binding.item);
  const modeSupplyFeed = dedupeCandidatesById([
    ...cachedFeed,
    ...retainedBindingItems,
  ]);
  const eligibleModeNativeIds = activeDurableMode && homePage
    ? nativeCards
        .filter((card) => (
          card.id
          && !card.id.startsWith('title:')
          && !shouldHideForSourceFilters(card.flags, sourceFilters)
        ))
        .map((card) => card.id)
    : [];
  latestModeSupplyPlan = activeDurableMode && homePage
    ? buildModeSupplyPlan({
        mode: activeDurableMode,
        sliderPercent: feedReplacementPercent,
        nativeIds: allNativeIds,
        eligibleNativeIds: eligibleModeNativeIds,
        feedItems: modeSupplyFeed,
        minimumReplacementScore: replacementMinimumScore,
      })
    : null;
  const replacementLimit = homePage
    ? latestModeSupplyPlan?.fillLimit
      ?? replacementQuota(feedReplacementPercent, nativeCards.length)
    : 0;

  nativeCards.forEach(({ element, id, title, flags }, nativeIndex) => {
    element.style.removeProperty('display');
    element.style.outline = '';
    element.style.outlineOffset = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;
    delete element.dataset.personalAlgorithmSlotId;
    delete element.dataset.personalAlgorithmSlotWidth;
    delete element.dataset.personalAlgorithmSlotHeight;
    delete element.dataset.personalAlgorithmReplacementCandidateId;
    delete element.dataset.personalAlgorithmSourceScore;
    element.querySelector('[data-personal-algorithm-badge]')?.remove();

    const item = feedById.get(id) ?? feedByTitle.get(title);
    const decision = getNativeCardDecision(item, {
      sourceFiltered: shouldHideForSourceFilters(flags, sourceFilters),
      // Keep an eligible native card until a specific replacement is ready.
      minimumVisibleScore: Number.NEGATIVE_INFINITY,
    });

    if (decision.action === 'hide') {
      const sourceVideoId = id;
      const slotRect = nativeCards[nativeIndex]?.rect ?? element.getBoundingClientRect();
      const slotWidth = slotRect.width;
      const slotHeight = slotRect.height;
      if (
        replacementLimit > 0
        && isReplacementEligibleNativeDecision(decision)
        && !sourceVideoId.startsWith('title:')
        && slotWidth >= 120
        && slotHeight >= 80
        && element.parentElement
      ) {
        element.dataset.personalAlgorithmSlotId = createReplacementSlotId(
          rankGeneration,
          getRouteKey(),
          nativeIndex,
          sourceVideoId,
        );
        const sourceScore = Number.isFinite(item?.score ?? NaN)
          ? Number(item?.score)
          : 0;
        element.dataset.personalAlgorithmSlotWidth = String(Math.round(slotWidth));
        element.dataset.personalAlgorithmSlotHeight = String(Math.round(slotHeight));
        element.dataset.personalAlgorithmSourceScore = String(sourceScore);

        const sticky = stableReplacementBySourceId.get(sourceVideoId);
        const stickyItem = sticky
          ? feedById.get(sticky.candidateId) ?? sticky.item
          : undefined;
        if (
          sticky
          && sticky.routeKey === currentRouteKey
          && sticky.bindingRevision === replacementBindingRevision
          && !nativeIds.has(sticky.candidateId)
          && isStableReplacementCandidateEligible(stickyItem, {
            activeMode: activeDurableMode,
            minimumScore: replacementMinimumScore,
            nativeScore: sourceScore,
            feedReplacementPercent,
          })
        ) {
          element.dataset.personalAlgorithmReplacementCandidateId = sticky.candidateId;
        } else if (sticky) {
          stableReplacementBySourceId.delete(sourceVideoId);
        }
      }
      element.style.setProperty('display', 'none', 'important');
      element.dataset.personalAlgorithmScore = decision.reason;
      return;
    }

    if (!item) {
      // Degraded coverage is pass-through: MyAlgo must not erase a native card
      // merely because the local candidate pool did not produce a score for it.
      element.dataset.personalAlgorithmScore = 'unmatched';
      return;
    }

    const score = item.score ?? 0;
    element.dataset.personalAlgorithmScore = String(score);
    element.dataset.personalAlgorithmRank = String(rankById.get(item.external_id) ?? -1);
    element.style.outline = score >= 68 ? '2px solid rgba(20, 184, 166, 0.7)' : '';
    element.style.outlineOffset = score >= 68 ? '3px' : '';

    let badge = element.querySelector<HTMLElement>('[data-personal-algorithm-badge]');
    if (!badge) {
      badge = document.createElement('span');
      badge.dataset.personalAlgorithmBadge = 'true';
      badge.style.cssText = 'position:absolute;z-index:999;top:8px;left:8px;max-width:calc(100% - 112px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 8px;border-radius:999px;background:#0f172a;color:#fff;font:700 11px/1.2 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;';
      const badgeHost = element.querySelector<HTMLElement>(
        '#thumbnail, ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail',
      ) ?? element;
      const computedPosition = getComputedStyle(badgeHost).position;
      if (computedPosition === 'static') {
        badgeHost.style.position = 'relative';
        badgeHost.dataset.personalAlgorithmPositionPatched = 'true';
      }
      badgeHost.appendChild(badge);
    }
    const contentLabel = getContentPresentationLabel(item);
    badge.textContent = contentLabel
      ? `${contentLabel} · MyAlgo reranked · ${score}`
      : `MyAlgo reranked · ${score}`;
    ensureNativeExplanationControl(element, item);
  });

  // Default mode preserves the general feed-replacement behavior. A durable
  // mode instead treats the slider as requested mode coverage: existing native
  // mode matches satisfy the quota first, then only grounded mode candidates
  // from the already-acquired reservoir may fill the shortfall.
  const existingReplacementSlots = knownElements.filter((element) => Boolean(
    element.dataset.personalAlgorithmSlotId
    && element.style.getPropertyValue('display') === 'none',
  )).length;
  let remainingReplacementCapacity = Math.max(
    0,
    replacementLimit - existingReplacementSlots,
  );

  let stableReplacementAssignments = 0;
  let opportunisticReplacementCandidates = 0;
  let opportunisticNativeTargets = 0;
  let opportunisticSelectedTargets = 0;
  let opportunisticUpliftQualified = 0;

  for (const sourceId of stableReplacementBySourceId.keys()) {
    if (!nativeIds.has(sourceId)) stableReplacementBySourceId.delete(sourceId);
  }

  if (remainingReplacementCapacity > 0) {
    const routeKey = currentRouteKey;
    const usedCandidateOwnerById = new Map<string, string>();
    for (const { element, id } of nativeCards) {
      const candidateId = element.dataset.personalAlgorithmReplacementCandidateId?.trim();
      if (candidateId && !usedCandidateOwnerById.has(candidateId)) {
        usedCandidateOwnerById.set(candidateId, id);
      }
    }

    // Keep a rendered replacement stable across ordinary YouTube DOM churn
    // while it remains eligible and, for a durable mode, still resolves to the
    // exact selected mode ID/revision.
    for (let nativeIndex = 0; nativeIndex < nativeCards.length && remainingReplacementCapacity > 0; nativeIndex += 1) {
      const { element, id } = nativeCards[nativeIndex];
      const sticky = stableReplacementBySourceId.get(id);
      if (!sticky) continue;
      if (sticky.routeKey !== routeKey) {
        stableReplacementBySourceId.delete(id);
        continue;
      }
      const item = feedById.get(sticky.candidateId) ?? sticky.item;
      const nativeScore = Number(element.dataset.personalAlgorithmScore);
      const sourceCandidateId = element.dataset.personalAlgorithmReplacementCandidateId?.trim();
      const sourceHidden = element.style.getPropertyValue('display') === 'none';
      if (isStableReplacementSourceSlotPrebound(
        sourceCandidateId,
        sticky.candidateId,
        sourceHidden,
      )) {
        usedCandidateOwnerById.set(sticky.candidateId, id);
        continue;
      }
      const valid = Boolean(
        sticky.bindingRevision === replacementBindingRevision
        && !nativeIds.has(sticky.candidateId)
        && isStableReplacementCandidateAvailableToSource(
          sticky.candidateId,
          id,
          usedCandidateOwnerById,
        )
        && element.parentElement
        && element.style.getPropertyValue('display') !== 'none'
        && isStableReplacementCandidateEligible(item, {
          activeMode: activeDurableMode,
          minimumScore: replacementMinimumScore,
          nativeScore,
          feedReplacementPercent,
        })
      );
      if (!valid) {
        stableReplacementBySourceId.delete(id);
        continue;
      }

      const slotRect = nativeCards[nativeIndex]?.rect ?? element.getBoundingClientRect();
      const slotWidth = slotRect.width;
      const slotHeight = slotRect.height;
      if (slotWidth < 120 || slotHeight < 80) continue;
      element.dataset.personalAlgorithmSlotId = createReplacementSlotId(
        rankGeneration,
        routeKey,
        nativeIndex,
        id,
      );
      element.dataset.personalAlgorithmSlotWidth = String(Math.round(slotWidth));
      element.dataset.personalAlgorithmSlotHeight = String(Math.round(slotHeight));
      element.dataset.personalAlgorithmReplacementCandidateId = sticky.candidateId;
      element.dataset.personalAlgorithmSourceScore = String(nativeScore);
      element.style.setProperty('display', 'none', 'important');
      element.dataset.personalAlgorithmScore = 'replacement_slot';
      usedCandidateOwnerById.set(sticky.candidateId, id);
      stableReplacementAssignments += 1;
      remainingReplacementCapacity -= 1;
    }

    if (remainingReplacementCapacity > 0) {
      const replacementSelectionSeed = createReplacementSelectionSeed(routeKey);
      const blockedReplacementIds = [...nativeIds, ...usedCandidateOwnerById.keys()];
      const candidateLimit = Math.max(24, remainingReplacementCapacity * 6);
      const modeRelevantMinimumScore = activeDurableMode && feedReplacementPercent >= 100
        ? 0
        : replacementMinimumScore;
      const groundedCandidates = latestModeSupplyPlan
        ? getReplacementCandidates(
            latestModeSupplyPlan.poolCandidates,
            blockedReplacementIds,
            candidateLimit,
            modeRelevantMinimumScore,
            replacementSelectionSeed,
          )
        : [];
      const groundedCandidateIds = groundedCandidates.map((item) => item.external_id);
      const provisionalModeCandidates = activeDurableMode && feedReplacementPercent >= 100
        ? getReplacementCandidates(
            cachedFeed.filter((item) => (
              isProvisionalDurableModeRelevantItem(item, activeDurableMode)
              && !isDurableModeGroundedItem(item, activeDurableMode)
            )),
            [...blockedReplacementIds, ...groundedCandidateIds],
            Math.max(0, candidateLimit - groundedCandidates.length),
            modeRelevantMinimumScore,
            replacementSelectionSeed,
          )
        : [];
      // Durable modes remain exact-grounding-first. At 100%, provisional
      // semantic matches may fill while exact graph grounding catches up, but
      // unrelated generic candidates never dilute the selected mode merely to
      // satisfy the percentage target.
      const replacementCandidates = latestModeSupplyPlan
        ? [...groundedCandidates, ...provisionalModeCandidates]
        : getReplacementCandidates(
            cachedFeed,
            blockedReplacementIds,
            candidateLimit,
            replacementMinimumScore,
            replacementSelectionSeed,
          );
      const nativeTargets = nativeCards.flatMap(({ element, id, title }, nativeIndex) => {
        if (element.style.getPropertyValue('display') === 'none') return [];
        const score = Number(element.dataset.personalAlgorithmScore);
        if (!id || id.startsWith('title:') || !Number.isFinite(score)) return [];
        const nativeItem = feedById.get(id) ?? feedByTitle.get(title);
        if (
          feedReplacementPercent < 100
          && activeDurableMode
          && isDurableModeGroundedItem(nativeItem, activeDurableMode)
        ) {
          return [];
        }
        return [{ externalId: id, score, nativeIndex }];
      });

      const selectedAssignments = selectFeedMixAssignments(
        nativeTargets,
        replacementCandidates,
        remainingReplacementCapacity,
        feedReplacementPercent,
        youtubeConnector.presentation.replacementMinimumUplift,
      );

      opportunisticReplacementCandidates = replacementCandidates.length;
      opportunisticNativeTargets = nativeTargets.length;
      opportunisticSelectedTargets = selectedAssignments.length;
      opportunisticUpliftQualified = selectedAssignments.length;

      for (const assignment of selectedAssignments) {
        const selected = assignment.target;
        const element = knownElements[selected.nativeIndex];
        if (!element?.parentElement || element.style.getPropertyValue('display') === 'none') continue;
        const slotRect = nativeCards[selected.nativeIndex]?.rect ?? element.getBoundingClientRect();
        const slotWidth = slotRect.width;
        const slotHeight = slotRect.height;
        if (slotWidth < 120 || slotHeight < 80) continue;
        element.dataset.personalAlgorithmSlotId = createReplacementSlotId(
          rankGeneration,
          routeKey,
          selected.nativeIndex,
          selected.externalId,
        );
        element.dataset.personalAlgorithmSlotWidth = String(Math.round(slotWidth));
        element.dataset.personalAlgorithmSlotHeight = String(Math.round(slotHeight));
        const replacementCandidateId = assignment.item.external_id ?? '';
        element.dataset.personalAlgorithmReplacementCandidateId = replacementCandidateId;
        if (replacementCandidateId) {
          usedCandidateOwnerById.set(replacementCandidateId, selected.externalId);
        }
        element.dataset.personalAlgorithmSourceScore = String(selected.score);
        element.style.setProperty('display', 'none', 'important');
        element.dataset.personalAlgorithmScore = 'replacement_slot';
      }
    }
  }

  // A binding that is no longer represented by a source slot in the current
  // presentation has lost its replacement intent (for example because mode
  // supply now satisfies the quota natively or capacity contracted). Do not
  // keep it latent and resurrect it on a later soft rerank.
  const reboundCandidateBySource = new Map(
    nativeCards.map(({ element, id }) => [
      id,
      element.dataset.personalAlgorithmReplacementCandidateId?.trim() ?? '',
    ]),
  );
  for (const [sourceId, binding] of stableReplacementBySourceId) {
    if (reboundCandidateBySource.get(sourceId) !== binding.candidateId) {
      stableReplacementBySourceId.delete(sourceId);
    }
  }

  syncSourceFilteredContainers();

  console.info('[MyAlgo] native presentation', {
    generation: rankGeneration,
    scoredCards: document.querySelectorAll('[data-personal-algorithm-score]').length,
    nativeBadges: document.querySelectorAll(
      '[data-personal-algorithm-score] [data-personal-algorithm-badge]',
    ).length,
    sourceFilteredCards: document.querySelectorAll(
      '[data-personal-algorithm-score="source_filter"]',
    ).length,
    hiddenSourceSections: document.querySelectorAll(
      '[data-personal-algorithm-source-section-hidden]',
    ).length,
    hiddenSourceRows: document.querySelectorAll(
      '[data-personal-algorithm-source-row-hidden]',
    ).length,
    hiddenSourceLayoutItems: document.querySelectorAll(
      '[data-personal-algorithm-source-layout-hidden]',
    ).length,
    stableReplacementAssignments,
    stableBindingCount: stableReplacementBySourceId.size,
    replacementBindingRevision,
    lastReplacementInvalidationReason,
    opportunisticReplacementCandidates,
    opportunisticNativeTargets,
    opportunisticSelectedTargets,
    retrievedDiscoveryExplorationAssignments: 0,
    feedReplacementPercent,
    replacementLimit,
    modeSupply: latestModeSupplyPlan
      ? {
          modeId: latestModeSupplyPlan.modeId,
          modeRevision: latestModeSupplyPlan.modeRevision,
          requestedModeSlots: latestModeSupplyPlan.requestedModeSlots,
          nativeModeSupply: latestModeSupplyPlan.nativeModeSupply,
          poolModeSupply: latestModeSupplyPlan.poolModeSupply,
          shortfall: latestModeSupplyPlan.shortfall,
          fillLimit: latestModeSupplyPlan.fillLimit,
        }
      : null,
    opportunisticUpliftQualified,
    replacementMinimumUplift: youtubeConnector.presentation.replacementMinimumUplift,
  });
};

const renderReplacementSlots = (
  generation: number,
  snapshot: NativeCardSnapshot = createNativeCardSnapshot({ measureGeometry: true }),
) => {
  const existingReplacements = Array.from(
    document.querySelectorAll<HTMLElement>('[data-personal-algorithm-replacement]'),
  );
  if (!isCurrentInstance() || !extensionEnabled || isYouTubeHistoryPage(location.pathname)) {
    existingReplacements.forEach((element) => element.remove());
    return;
  }

  const nativeElements = snapshot.cards.map((card) => card.element);
  const replacementMinimumScore = youtubeConnector.presentation.replacementMinimumScore
    * (1 - feedReplacementPercent / 100);
  const targets = nativeElements.filter((element) => (
    Boolean(element.dataset.personalAlgorithmSlotId)
    && element.style.getPropertyValue('display') === 'none'
    && element.parentElement
  ));
  const slots = targets.map((element) => ({
    slotId: element.dataset.personalAlgorithmSlotId ?? '',
    sourceVideoId: snapshot.cardByElement.get(element)?.id ?? getVideoId(element),
  }));

  const blockedIds = new Set<string>();
  snapshot.cards.forEach(({ id }) => {
    if (id && !id.startsWith('title:')) blockedIds.add(id);
  });
  // Shelf candidates are separate visible placements and cannot be reused as
  // replacements. Existing replacement candidates are handled through bound
  // assignments below so their own source slot can retain them across reranks.
  document.querySelectorAll<HTMLElement>(
    '[data-personal-algorithm-shelf] [data-personal-algorithm-video-id]',
  ).forEach((element) => {
    const id = element.dataset.personalAlgorithmVideoId;
    if (id) blockedIds.add(id);
  });

  const replacementCandidateDiagnostics = {
    feed: cachedFeed.length,
    traced: cachedFeed.filter((item) => Boolean(item.traceId)).length,
    visible: cachedFeed.filter((item) => item.visible !== false).length,
    eligible: cachedFeed.filter((item) => (
      item.suppressed !== true
      && (item.policyOutcome == null || item.policyOutcome === 'eligible')
    )).length,
    positiveScore: cachedFeed.filter((item) => (
      (item.score ?? 0) >= replacementMinimumScore
    )).length,
  };
  const replacementQualifiedBeforeBlocking = cachedFeed.filter((item) => (
    Boolean(item.external_id && item.title && item.traceId)
    && item.visible !== false
    && item.suppressed !== true
    && (item.policyOutcome == null || item.policyOutcome === 'eligible')
    && (item.score ?? 0) >= replacementMinimumScore
  )).length;
  const targetBySlot = new Map(targets.map((element) => [element.dataset.personalAlgorithmSlotId ?? '', element]));
  const feedById = new Map(cachedFeed.map((item) => [item.external_id, item]));
  const boundAssignments = slots.flatMap((slot) => {
    const target = targetBySlot.get(slot.slotId);
    const candidateId = target?.dataset.personalAlgorithmReplacementCandidateId?.trim();
    const sticky = stableReplacementBySourceId.get(slot.sourceVideoId);
    const retainedItem = sticky
      && sticky.candidateId === candidateId
      && sticky.routeKey === getRouteKey()
      && sticky.bindingRevision === replacementBindingRevision
      ? sticky.item
      : undefined;
    const item = candidateId
      ? feedById.get(candidateId) ?? retainedItem
      : undefined;
    const nativeScore = Number(target?.dataset.personalAlgorithmSourceScore);
    if (
      !item
      || blockedIds.has(candidateId ?? '')
      || !isStableReplacementCandidateEligible(item, {
        activeMode: activeDurableMode,
        minimumScore: replacementMinimumScore,
        nativeScore,
        feedReplacementPercent,
      })
    ) {
      return [];
    }
    return [{ slot, item }];
  });
  const boundSlotIds = new Set(boundAssignments.map((assignment) => assignment.slot.slotId));
  const boundCandidateIds = new Set(boundAssignments.map((assignment) => assignment.item.external_id));
  const replacementSource = activeDurableMode
    ? cachedFeed.filter((item) => (
        feedReplacementPercent < 100
          ? isDurableModeGroundedItem(item, activeDurableMode)
          : isProvisionalDurableModeRelevantItem(item, activeDurableMode)
      ))
    : cachedFeed;
  const fallbackAssignments = planReplacementAssignments(
    replacementSource,
    slots.filter((slot) => !boundSlotIds.has(slot.slotId)),
    [...blockedIds, ...boundCandidateIds],
    replacementMinimumScore,
    createReplacementSelectionSeed(getRouteKey()),
  );
  const assignmentLimit = isYouTubeHomePage(location.pathname)
    ? latestModeSupplyPlan?.fillLimit
      ?? replacementQuota(feedReplacementPercent, nativeElements.length)
    : 0;
  const assignments = [...boundAssignments, ...fallbackAssignments]
    .slice(0, assignmentLimit);
  const existingBySourceId = new Map<string, HTMLElement>();
  for (const replacement of existingReplacements) {
    const sourceId = replacement.dataset.personalAlgorithmReplacementSourceVideoId?.trim();
    if (sourceId && !existingBySourceId.has(sourceId)) existingBySourceId.set(sourceId, replacement);
  }
  const retainedReplacements = new Set<HTMLElement>();
  let filled = 0;
  let reused = 0;
  let filledGroundedModeSlots = 0;

  for (const assignment of assignments) {
    const target = targetBySlot.get(assignment.slot.slotId);
    if (
      !target
      || !target.isConnected
      || target.style.getPropertyValue('display') !== 'none'
      || target.dataset.personalAlgorithmSlotId !== assignment.slot.slotId
      || !target.parentElement
    ) {
      continue;
    }

    const existing = existingBySourceId.get(assignment.slot.sourceVideoId);
    const replacementVideoId = assignment.item.external_id ?? '';
    target.dataset.personalAlgorithmReplacementCandidateId = replacementVideoId;
    if (
      existing
      && existing.isConnected
      && existing.dataset.personalAlgorithmVideoId === replacementVideoId
    ) {
      refreshReplacementCardPresentation(
        existing,
        assignment.item,
        target,
        assignment.slot.slotId,
        assignment.slot.sourceVideoId,
        generation,
      );
      if (existing.parentElement !== target.parentElement || target.previousElementSibling !== existing) {
        target.parentElement.insertBefore(existing, target);
      }
      retainedReplacements.add(existing);
      reused += 1;
      filled += 1;
    } else {
      existing?.remove();
      const replacement = createReplacementCard(
        assignment.item,
        target,
        assignment.slot.slotId,
        assignment.slot.sourceVideoId,
        generation,
      );
      target.parentElement.insertBefore(replacement, target);
      retainedReplacements.add(replacement);
      filled += 1;
    }

    stableReplacementBySourceId.set(assignment.slot.sourceVideoId, {
      candidateId: replacementVideoId,
      item: assignment.item,
      routeKey: getRouteKey(),
      bindingRevision: replacementBindingRevision,
    });
    if (
      activeDurableMode
      && isDurableModeGroundedItem(assignment.item, activeDurableMode)
    ) {
      filledGroundedModeSlots += 1;
    }
  }

  for (const replacement of existingReplacements) {
    if (!retainedReplacements.has(replacement)) replacement.remove();
  }

  persistModeSupplyDiagnostics(
    latestModeSupplyPlan,
    activeDurableMode ? filledGroundedModeSlots : filled,
  );

  console.info('[MyAlgo] replacement slots', {
    generation,
    eligibleSlots: slots.length,
    filled,
    reused,
    stableBindingCount: stableReplacementBySourceId.size,
    replacementBindingRevision,
    lastReplacementInvalidationReason,
    unfilled: Math.max(0, slots.length - filled),
    qualifiedBeforeBlocking: replacementQualifiedBeforeBlocking,
    assignableAfterBlocking: assignments.length,
    blockedNativeIds: blockedIds.size,
    offPageCandidates: cachedFeed.filter((item) => item.external_id && !blockedIds.has(item.external_id)).length,
    boundAssignments: boundAssignments.length,
    fallbackAssignments: fallbackAssignments.length,
    modeSupply: latestModeSupplyPlan
      ? {
          modeId: latestModeSupplyPlan.modeId,
          modeRevision: latestModeSupplyPlan.modeRevision,
          requestedModeSlots: latestModeSupplyPlan.requestedModeSlots,
          nativeModeSupply: latestModeSupplyPlan.nativeModeSupply,
          poolModeSupply: latestModeSupplyPlan.poolModeSupply,
          shortfall: latestModeSupplyPlan.shortfall,
          fulfilledModeSlots: Math.min(
            latestModeSupplyPlan.requestedModeSlots,
            latestModeSupplyPlan.nativeModeSupply + filled,
          ),
        }
      : null,
    candidates: replacementCandidateDiagnostics,
  });
};

const scheduleRankGeneration = (generation: number, delayMs = 320) => {
  if (rankTimer !== undefined) window.clearTimeout(rankTimer);
  rankTimer = window.setTimeout(() => {
    rankTimer = undefined;
    if (!isCurrentInstance() || !extensionEnabled) return;
    if (rankingInFlight) {
      rankQueued = true;
      return;
    }
    void rankCurrentPage(generation);
  }, delayMs);
};

const scheduleLatestRank = () => {
  rankQueued = false;
  scheduleRankGeneration(rankGeneration, 120);
};


const applyRankedPresentation = (generation = rankGeneration) => {
  const startedAt = performance.now();
  const snapshot = createNativeCardSnapshot({ measureGeometry: true });
  const discoveryMs = performance.now() - startedAt;
  const applyStartedAt = performance.now();
  applyRankedFeed(snapshot);
  const applyMs = performance.now() - applyStartedAt;
  const replacementStartedAt = performance.now();
  renderReplacementSlots(generation, snapshot);
  syncSourceFilteredContainers();
  const replacementMs = performance.now() - replacementStartedAt;
  console.info('[MyAlgo] presentation timing', {
    nativeCardCount: snapshot.cards.length,
    candidateDiscoveryMs: Math.round(discoveryMs),
    applyRankedFeedMs: Math.round(applyMs),
    replacementRenderMs: Math.round(replacementMs),
  });
};

const rankCurrentPage = async (requestGeneration: number) => {
  if (!isCurrentInstance() || !extensionEnabled || isYouTubeHistoryPage(location.pathname)) return;
  if (rankingInFlight) {
    rankQueued = true;
    return;
  }

  const requestRouteKey = getRouteKey();
  const candidates = collectCandidates();
  if (candidates.length === 0) {
    showStatus(`Personal Algorithm: no cards on ${location.hostname}`, true);
    return;
  }

  rankingInFlight = true;
  showStatus(`Personal Algorithm: ranking ${candidates.length} videos`);
  const requestMode = activeMode;
  const requestContext = { generation: requestGeneration, routeKey: requestRouteKey, mode: requestMode };
  const currentContext = { generation: rankGeneration, routeKey: getRouteKey(), mode: activeMode };
  if (isRenderContextStale(requestContext, currentContext)) {
    rankingInFlight = false;
    logStaleRender('before-request', requestGeneration);
    scheduleLatestRank();
    return;
  }

  const candidateSignature = candidates.map((candidate) => candidate.external_id).sort().join('|');
  if (candidateSignature === lastCandidateSignature && activeMode === lastRankMode && cachedFeed.length > 0) {
    // Reuse the already-scored feed for presentation, but do not skip semantic
    // enrichment. A warm feed cache can outlive semantic caches (for example
    // after a model-mode switch or extension update), and previously this early
    // return meant no semantic pass/diagnostics would ever be produced.
    safeSendMessage({
      type: 'REFRESH_SEMANTICS',
      payload: { mode: requestMode, candidates },
    });
    rankingInFlight = false;
    applyRankedPresentation(rankGeneration);
    clearLegacyRecommendationShelf();
    if (rankQueued) scheduleLatestRank();
    return;
  }

  safeSendMessage({ type: 'RANK_PAGE', payload: { mode: requestMode, candidates } }, (response) => {
    rankingInFlight = false;
    const latestContext = { generation: rankGeneration, routeKey: getRouteKey(), mode: activeMode };
    if (!isCurrentInstance() || isRenderContextStale(requestContext, latestContext)) {
      if (isCurrentInstance()) logStaleRender('rank-response', requestGeneration);
      if (isCurrentInstance() && extensionEnabled) scheduleLatestRank();
      return;
    }

    if (response?.ok && Array.isArray(response.feed)) {
      activeDurableMode = response.activeDurableMode
        && typeof response.activeDurableMode.id === 'string'
        && Number.isInteger(response.activeDurableMode.revision)
        ? {
            id: response.activeDurableMode.id,
            label: response.activeDurableMode.label ?? activeMode,
            revision: response.activeDurableMode.revision,
            memberLabels: Array.isArray(response.activeDurableMode.memberLabels)
              ? response.activeDurableMode.memberLabels
              : [],
          }
        : null;
      console.info('[MyAlgo] rank response', {
        generation: requestGeneration,
        pageCandidates: candidates.length,
        feed: response.feed.length,
        backgroundElapsedMs: response.elapsedMs ?? null,
        phaseTimings: response.phaseTimings ?? null,
        cacheWarm: response.cacheWarm ?? null,
        scoreCache: response.scoreCache ?? null,
        scoreCalibration: response.scoreCalibration ?? null,
        rankingWorkingSetSize: response.rankingWorkingSetSize ?? null,
        replacementInventorySize: response.replacementInventorySize ?? null,
        searchCandidatesScored: response.searchCandidatesScored ?? null,
        searchCandidatesQualified: response.searchCandidatesQualified ?? null,
        searchCandidatesInReplacementInventory: response.searchCandidatesInReplacementInventory ?? null,
        maxSearchCandidateScore: response.maxSearchCandidateScore ?? null,
        enrichmentPending: response.enrichmentPending === true,
      });
      cachedFeed = response.feed;
      lastCandidateSignature = candidateSignature;
      lastRankMode = requestMode;

      // Preserve valid replacement nodes through ordinary reranks so the
      // source→candidate binding can be reused instead of visually torn down.
      // Hard lifecycle/policy changes remove replacements before reaching this
      // response path.
      clearExtensionPresentation(false, true);
      applyRankedPresentation(requestGeneration);
      clearLegacyRecommendationShelf();

      const visibleCount = response.feed.filter((item: RankedFeedItem) => (
        item.visible !== false
        && item.suppressed !== true
        && (item.policyOutcome == null || item.policyOutcome === 'eligible')
        && (item.score ?? 0) >= youtubeConnector.presentation.minimumVisibleScore
      )).length;
      if (latestModeSupplyPlan?.shortfall) {
        showStatus(
          `MyAlgo · ${latestModeSupplyPlan.modeLabel}: ${latestModeSupplyPlan.nativeModeSupply}/${latestModeSupplyPlan.requestedModeSlots} native · ${latestModeSupplyPlan.poolModeSupply} pool`,
        );
      } else {
        showStatus(`MyAlgo: ${visibleCount} scored visible · ${response.feed.length - visibleCount} scored hidden`);
      }
    } else {
      console.warn('[MyAlgo] native feed ranking failed', { phase: 'rank-response' });
      showStatus(`Personal Algorithm: ${response?.error ?? 'ranking failed'}`, true);
    }
    if (rankQueued) scheduleLatestRank();
  });
};

const triggerRank = (
  reason: ReplacementRerankReason = 'manual',
) => {
  if (!isCurrentInstance() || !extensionEnabled || isYouTubeHistoryPage(location.pathname)) return;

  const invalidateBindings = shouldInvalidateStableReplacementBindings(reason);
  if (invalidateBindings) {
    invalidateStableReplacements(reason);
    // A hard invalidation removes the incumbent replacement intent entirely.
    // Restore hidden native targets immediately rather than leaving blank slots
    // while the fresh policy/graph/mode rank is in flight.
    clearExtensionPresentation(false);
  }

  if (
    reason === 'metadata'
    || reason === 'semantic'
    || reason === 'retrieval'
    || reason === 'graph'
  ) {
    // Soft reranks keep valid bindings; graph changes invalidate them. Both
    // still require a fresh score pass rather than the same-signature cache
    // shortcut.
    lastCandidateSignature = '';
  }

  if (rankingInFlight) {
    rankQueued = true;
    // Ordinary mutation/metadata/semantic/retrieval churn must not invalidate
    // the response already in flight. Hard intent/policy changes do.
    if (
      reason !== 'mutation'
      && reason !== 'metadata'
      && reason !== 'semantic'
      && reason !== 'retrieval'
      && reason !== 'manual'
    ) {
      rankGeneration += 1;
    }
    return;
  }

  const generation = ++rankGeneration;
  const delayMs = reason === 'mutation'
    ? 320
    : reason === 'metadata' || reason === 'semantic' || reason === 'retrieval'
      ? 120
      : 60;
  scheduleRankGeneration(generation, delayMs);
};
const scheduleInitialRank = (attempt = 0) => {
  if (!extensionEnabled || !isCurrentInstance() || isYouTubeHistoryPage(location.pathname)) return;
  window.setTimeout(() => {
    if (!extensionEnabled || !isCurrentInstance()) return;
    const currentCandidates = collectCandidates();
    if (currentCandidates.length >= 2) {
      triggerRank('manual');
      return;
    }
    if (attempt < 8) scheduleInitialRank(attempt + 1);
  }, attempt === 0 ? 40 : 180);
};

safeStorageGet([
  STORAGE_KEYS.MODE,
  STORAGE_KEYS.ACTIVE_MODE_ID,
  STORAGE_KEYS.DURABLE_MODE_CATALOG,
  STORAGE_KEYS.ENABLED,
  STORAGE_KEYS.SOURCE_FILTERS,
  STORAGE_KEYS.FEED_REPLACEMENT_PERCENT,
  STORAGE_KEYS.PRESENTATION_CACHE,
  STORAGE_KEYS.PRIVACY_DISCLOSURE_ACCEPTED_VERSION,
]).then((result) => {
  activeMode = (result[STORAGE_KEYS.MODE] as string) ?? activeMode;
  activeDurableMode = resolveDurableModeContext(
    result[STORAGE_KEYS.ACTIVE_MODE_ID],
    result[STORAGE_KEYS.DURABLE_MODE_CATALOG] as DurableSemanticModeCatalog | null | undefined,
  );
  sourceFilters = result[STORAGE_KEYS.SOURCE_FILTERS] as FeedSourceFilters | undefined ?? {};
  const storedPercent = Number(result[STORAGE_KEYS.FEED_REPLACEMENT_PERCENT] ?? 0);
  feedReplacementPercent = Number.isFinite(storedPercent)
    ? Math.max(0, Math.min(100, storedPercent)) : 0;
  const disclosureAccepted = isPrivacyDisclosureAccepted(
    result[STORAGE_KEYS.PRIVACY_DISCLOSURE_ACCEPTED_VERSION],
  );
  extensionEnabled = disclosureAccepted
    && result[STORAGE_KEYS.ENABLED] !== false;
  if (!extensionEnabled) {
    clearExtensionPresentation(false);
    return;
  }

  const presentationCache = result[STORAGE_KEYS.PRESENTATION_CACHE] as PresentationCache | undefined;
  const selectedActiveModeId = typeof result[STORAGE_KEYS.ACTIVE_MODE_ID] === 'string'
    ? String(result[STORAGE_KEYS.ACTIVE_MODE_ID])
    : 'default';
  const cacheMatchesMode = Boolean(
    presentationCache
    && Array.isArray(presentationCache.feed)
    && presentationCache.mode === activeMode
    && presentationCache.activeModeId === selectedActiveModeId
    && presentationCache.activeModeRevision === (activeDurableMode?.revision ?? null)
  );
  if (cacheMatchesMode) {
    cachedFeed = presentationCache!.feed;
    lastRankMode = activeMode;
  }

  // Paint from the last mode-compatible ranked presentation immediately. Fresh
  // scoring reconciles it in place; it no longer has to gate first visual fill.
  applyRankedPresentation(rankGeneration);
  showStatus('Personal Algorithm: Active', false, false);
  clearLegacyRecommendationShelf();
  scheduleInitialRank();
});

const sourceFiltersEqual = (left: FeedSourceFilters, right: FeedSourceFilters) => (
  left.subscribedOnly === right.subscribedOnly
  && left.includeDiscovery === right.includeDiscovery
  && left.includeShorts === right.includeShorts
  && left.includeLive === right.includeLive
  && left.includePlayables === right.includePlayables
);

const applySourceFilters = (nextFilters: FeedSourceFilters) => {
  if (!isCurrentInstance() || sourceFiltersEqual(sourceFilters, nextFilters)) return;
  sourceFilters = nextFilters;
  invalidateStableReplacements('policy');
  rankGeneration += 1;

  // Keep the last valid scored generation available for the optimistic local
  // presentation pass, but do not reuse a binding created under the old source
  // policy.
  clearExtensionPresentation(false);
  applyRankedFeed();
  syncSourceFilteredContainers();

  lastCandidateSignature = '';
  lastRankMode = '';
  triggerRank('manual');
};

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !isCurrentInstance()) return;
  const nextFilters = changes[STORAGE_KEYS.SOURCE_FILTERS]?.newValue as FeedSourceFilters | undefined;
  if (nextFilters) applySourceFilters(nextFilters);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isCurrentInstance()) return;
  if (message?.type === 'YOUTUBE_METADATA_ENRICHED') {
    if (extensionEnabled) triggerRank('metadata');
    return;
  }
  if (message?.type === 'YOUTUBE_SEMANTICS_ENRICHED') {
    if (extensionEnabled) {
      triggerRank(message.payload?.conceptGraphChanged === true ? 'graph' : 'semantic');
    }
    return;
  }
  if (message?.type === 'EXTENSION_ENABLED' && typeof message.payload?.enabled === 'boolean') {
    extensionEnabled = message.payload.enabled;
    invalidateStableReplacements('lifecycle');
    rankGeneration += 1;
    if (rankTimer !== undefined) window.clearTimeout(rankTimer);
    rankTimer = undefined;
    rankQueued = false;
    cachedFeed = [];
      lastCandidateSignature = '';
    lastRankMode = '';
    clearExtensionPresentation(!extensionEnabled);

    if (extensionEnabled) {
      // Activation is a hard lifecycle boundary. Do not let an in-flight
      // request from before the pause strand the clean page waiting for its
      // callback; its generation is already stale and cannot render.
      rankingInFlight = false;
      void safeStorageGet([
        STORAGE_KEYS.MODE,
        STORAGE_KEYS.ACTIVE_MODE_ID,
        STORAGE_KEYS.DURABLE_MODE_CATALOG,
      ]).then((result) => {
        if (!isCurrentInstance() || !extensionEnabled) return;
        activeMode = (result[STORAGE_KEYS.MODE] as string) ?? activeMode;
        activeDurableMode = resolveDurableModeContext(
          result[STORAGE_KEYS.ACTIVE_MODE_ID],
          result[STORAGE_KEYS.DURABLE_MODE_CATALOG] as DurableSemanticModeCatalog | null | undefined,
        );
        showStatus(`Personal Algorithm: Active · ${activeMode}`, false, false);
        clearLegacyRecommendationShelf();
        triggerRank('manual');
      });
    }
    return;
  }
  if (message?.type === 'SOURCE_FILTERS_CHANGED') {
    const nextFilters = message.payload?.sourceFilters as FeedSourceFilters | undefined;
    if (nextFilters) {
      applySourceFilters(nextFilters);
      clearLegacyRecommendationShelf();
      return;
    }
    void safeStorageGet([STORAGE_KEYS.SOURCE_FILTERS]).then((result) => {
      applySourceFilters(
        result[STORAGE_KEYS.SOURCE_FILTERS] as FeedSourceFilters | undefined ?? {},
      );
      clearLegacyRecommendationShelf();
    });
    return;
  }
  if (message?.type === 'FEED_REPLACEMENT_CHANGED') {
    const next = Number(message.payload?.percent);
    if (!Number.isFinite(next) || next === feedReplacementPercent) return;
    feedReplacementPercent = Math.max(0, Math.min(100, next));
    invalidateStableReplacements('feed_mix');
    rankGeneration += 1;
    clearExtensionPresentation(false);
    applyRankedPresentation(rankGeneration);
    triggerRank('manual');
    return;
  }
  if (message?.type === 'PERSONAL_ALGORITHM_CHANGED') {
    const reason = String(message.payload?.reason ?? 'rebuild');
    if (reason === 'retrieval') {
      lastCandidateSignature = '';
      triggerRank('retrieval');
      return;
    }

    cachedFeed = [];
    lastCandidateSignature = '';
    lastRankMode = '';
    clearExtensionPresentation(false);
    triggerRank(reason === 'feedback' ? 'feedback' : 'graph');
    return;
  }
  if (message?.type !== 'MODE_CHANGED' || typeof message.payload?.mode !== 'string') return;
  rankGeneration += 1;
  activeMode = message.payload.mode;
  activeDurableMode = typeof message.payload?.modeId === 'string'
    && message.payload.modeId !== 'default'
    && Number.isInteger(message.payload?.modeRevision)
    ? {
        id: message.payload.modeId,
        label: message.payload.mode,
        revision: message.payload.modeRevision,
        memberLabels: Array.isArray(message.payload?.memberLabels)
          ? message.payload.memberLabels
          : [],
      }
    : null;
  latestModeSupplyPlan = null;
  lastModeSupplySignature = '';
  cachedFeed = [];
  lastCandidateSignature = '';
  lastRankMode = '';
  clearExtensionPresentation(false);
  clearLegacyRecommendationShelf();
  triggerRank('mode');
});

const isWatchPage = () => location.pathname === '/watch' || location.pathname.startsWith('/shorts/');

const isYouTubeAdShowing = () => Boolean(
  document.querySelector('#movie_player.ad-showing, .html5-video-player.ad-showing'),
);

const getActiveWatchVideo = (): HTMLVideoElement | null => {
  if (!isWatchPage() || isYouTubeAdShowing()) return null;
  const player = document.querySelector<HTMLElement>('#movie_player, ytd-player .html5-video-player');
  const video = player?.querySelector<HTMLVideoElement>('video.html5-main-video, video')
    ?? document.querySelector<HTMLVideoElement>('video.html5-main-video');
  return video;
};

const emitTemporalWatch = (ended = false) => {
  if (!watchSession) return;
  const observation = createTemporalWatchObservation(
    watchSession,
    new Date().toISOString(),
    ended,
  );
  if (!observation) return;
  watchSession = markWatchEmitted(watchSession);
  safeSendMessage({
    type: EXTENSION_MESSAGE_TYPES.WATCH_OBSERVATION,
    payload: { observation },
  });
};

const attachTemporalWatchObserver = () => {
  if (!extensionEnabled || !isCurrentInstance()) return;
  const video = getActiveWatchVideo();
  if (!video) return;
  if (video === watchedVideo) return;

  watchedVideo = video;
  const videoId = youtubeConnector.getExternalId(location.href);
  if (!videoId) {
    watchSession = null;
    return;
  }

  const pendingSelectionIsFresh = pendingWatchExposure
    && Date.now() - pendingWatchExposure.observedAt <= WATCH_SELECTION_INTENT_MAX_AGE_MS;
  const selectedExposure = pendingSelectionIsFresh && pendingWatchExposure?.videoId === videoId
    ? pendingWatchExposure.exposureId
    : null;
  if (pendingWatchExposure?.videoId === videoId) {
    pendingWatchExposure = null;
  }

  watchSessionSequence += 1;
  watchSession = createWatchSession({
    videoId,
    exposureId: selectedExposure,
    sessionId: `${videoId}|player|${watchSessionSequence}`,
    currentTime: video.currentTime,
    durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
  });

  const update = () => {
    if (video !== watchedVideo || !watchSession) return;
    watchSession = advanceWatchSession(watchSession, {
      currentTime: video.currentTime,
      durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
      isPlaying: !video.paused && !video.ended && !isYouTubeAdShowing(),
      isSeeking: video.seeking,
    });
    emitTemporalWatch();
  };

  const onSeeking = () => {
    if (!watchSession) return;
    watchSession = {
      ...advanceWatchSession(watchSession, {
        currentTime: video.currentTime,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
        isPlaying: false,
        isSeeking: true,
      }),
      seeking: true,
    };
  };

  const onSeeked = () => {
    if (!watchSession) return;
    watchSession = resetWatchSeek(watchSession, video.currentTime);
  };

  const onEnded = () => {
    if (!watchSession) return;
    watchSession = advanceWatchSession(watchSession, {
      currentTime: video.currentTime,
      durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
      isPlaying: true,
    });
    emitTemporalWatch(true);
  };

  video.addEventListener('timeupdate', update);
  video.addEventListener('playing', update);
  video.addEventListener('pause', update);
  video.addEventListener('waiting', update);
  video.addEventListener('seeking', onSeeking);
  video.addEventListener('seeked', onSeeked);
  video.addEventListener('ended', onEnded);
};

const FEEDBACK_CONTEXT_MAX_AGE_MS = 5000;

let pendingFeedbackContext: { contentItemId: string; openedAt: number } | null = null;

const getFeedbackEventType = (element: Element) => {
  const label = normalizeText(
    element.textContent
      ?? element.getAttribute('aria-label')
      ?? element.getAttribute('title')
      ?? '',
  );
  if (label.includes('more like this')) return 'more_like_this';
  if (label.includes('never show')) return 'never_show_channel';
  if (label.includes('not interested')) return 'not_interested';
  return null;
};

const getMoreActionsTrigger = (target: Element) => {
  const candidate = target.closest(
    'button, yt-icon-button, tp-yt-paper-icon-button, ytd-menu-renderer, #button',
  );
  if (!candidate) return null;

  const label = normalizeText(
    candidate.getAttribute('aria-label')
      ?? candidate.getAttribute('title')
      ?? candidate.textContent
      ?? '',
  );

  return label.includes('more actions') || label === 'more' || label.includes('options')
    ? candidate
    : null;
};

const registerFeedbackHandlers = () => {
  if (!isCurrentInstance()) return;

  document.addEventListener('click', (event) => {
    if (!isCurrentInstance() || !extensionEnabled) return;

    const target = event.target instanceof Element ? event.target : null;
    if (!target || isMyAlgoInjectedElement(target)) return;

    const trigger = getMoreActionsTrigger(target);
    if (trigger) {
      const card = trigger.closest(
        'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer',
      ) as HTMLElement | null;
      const contentItemId = card ? getVideoId(card) : '';
      if (contentItemId && !contentItemId.startsWith('title:')) {
        pendingFeedbackContext = {
          contentItemId,
          openedAt: Date.now(),
        };
      }
      return;
    }

    const eventType = getFeedbackEventType(target);
    if (!eventType) return;

    const context = pendingFeedbackContext;
    pendingFeedbackContext = null;
    if (!context || Date.now() - context.openedAt > FEEDBACK_CONTEXT_MAX_AGE_MS) return;

    safeSendMessage({
      type: EXTENSION_MESSAGE_TYPES.FEEDBACK,
      payload: {
        contentItemId: context.contentItemId,
        eventType,
      },
    });
  }, true);
};

registerFeedbackHandlers();

window.addEventListener('load', () => {
  scheduleInitialRank();
  clearLegacyRecommendationShelf();
  scheduleHomeRecommendationObservation();
  attachTemporalWatchObserver();
});
window.addEventListener('yt-navigate-start', () => {
  invalidateStableReplacements('navigation');
  navigationInvalidationPending = true;
  if (mutationRankTimer !== undefined) {
    window.clearTimeout(mutationRankTimer);
    mutationRankTimer = undefined;
  }
  if (optimisticPresentationFrame !== undefined) {
    window.cancelAnimationFrame(optimisticPresentationFrame);
    optimisticPresentationFrame = undefined;
  }
  watchedVideo = null;
  watchSession = null;
  rankGeneration += 1;
  cachedFeed = [];
  lastCandidateSignature = '';
  lastRankMode = '';
  clearExtensionPresentation(false);
});
window.addEventListener('yt-navigate-finish', () => {
  attachTemporalWatchObserver();
  const currentVideoId = youtubeConnector.getExternalId(window.location.href);
    if (currentVideoId) sendActivity(currentVideoId, 'revisited');
  if (isYouTubeHistoryPage(location.pathname)) {
    navigationInvalidationPending = false;
    scheduleHistoryObservation();
  } else {
    clearLegacyRecommendationShelf();
    const rerankReason = navigationFinishRerankReason(
      navigationInvalidationPending,
    );
    navigationInvalidationPending = false;
    triggerRank(rerankReason);
    scheduleHomeRecommendationObservation();
  }
});
window.addEventListener('yt-page-data-updated', () => {
  // YouTube emits this during ordinary in-route Home refreshes as well as
  // navigation-adjacent updates. The actual navigation lifecycle already
  // clears state on yt-navigate-start, so treat this as mutation churn here.
  triggerRank('mutation');
});
window.addEventListener('popstate', () => {
  if (!isYouTubeHistoryPage(location.pathname)) triggerRank('navigation');
  else scheduleHistoryObservation();
});
window.addEventListener('resize', () => {
  if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = undefined;
    clearLegacyRecommendationShelf();
  }, 120);
});

const scheduleOptimisticPresentation = () => {
  if (
    optimisticPresentationFrame !== undefined
    || !extensionEnabled
    || cachedFeed.length === 0
    || !isYouTubeHomePage(location.pathname)
  ) return;

  optimisticPresentationFrame = window.requestAnimationFrame(() => {
    optimisticPresentationFrame = undefined;
    if (!isCurrentInstance() || !extensionEnabled || cachedFeed.length === 0) return;
    applyRankedPresentation(rankGeneration);
  });
};

const pageObserver = new MutationObserver((records) => {
  const hasNonInjectedMutation = records.some((record) => {
    const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    return changedNodes.some((node) => {
      if (!(node instanceof Element)) return false;
      return !node.matches(MYALGO_INJECTED_SELECTOR)
        && !node.closest(MYALGO_INJECTED_SELECTOR);
    });
  });

  const hasNativeVideoMutation = records.some((record) => Array.from(record.addedNodes).some((node) => {
    if (!(node instanceof Element)) return false;
    if (node.closest(MYALGO_INJECTED_SELECTOR)) return false;
    return node.matches(`${videoSelectors.join(',')}, ${videoLinkSelector}`)
      || Boolean(node.querySelector(`${videoSelectors.join(',')}, ${videoLinkSelector}`));
  }));

  if (hasNativeVideoMutation) {
    // Reuse the last valid ranked presentation immediately as YouTube recycles
    // or appends Home cards. Fresh scoring still follows asynchronously.
    scheduleOptimisticPresentation();

    // YouTube can emit dozens of subtree mutations for one visual feed update.
    // Coalesce them before collecting/scoring the DOM rather than invoking
    // collectCandidates() for every observer callback.
    if (mutationRankTimer !== undefined) window.clearTimeout(mutationRankTimer);
    mutationRankTimer = window.setTimeout(() => {
      mutationRankTimer = undefined;
      if (isCurrentInstance() && extensionEnabled) triggerRank('mutation');
    }, 450);
  }

  const hasSourceShelfMutation = records.some((record) => Array.from(record.addedNodes).some((node) => {
    if (!(node instanceof Element)) return false;
    return node.matches('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytd-shelf-renderer')
      || Boolean(node.querySelector('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytd-shelf-renderer'));
  }));
  if (hasSourceShelfMutation && (
    sourceFilters.includeShorts === false
    || sourceFilters.includePlayables === false
  )) {
    syncSourceFilteredContainers();
  }

  if (hasNonInjectedMutation) {
    if (isYouTubeHistoryPage(location.pathname)) scheduleHistoryObservation();
    if (isYouTubeHomePage(location.pathname)) scheduleHomeRecommendationObservation();
    attachTemporalWatchObserver();
  }
});
pageObserver.observe(document.documentElement, { childList: true, subtree: true });

window.setInterval(() => {
  if (isWatchPage()) attachTemporalWatchObserver();
}, 2500);

const recordSelection = (event: MouseEvent | KeyboardEvent, kind: 'click' | 'auxclick' | 'keyboard') => {
  if (!isCurrentInstance() || !extensionEnabled) return;
  const target = event.target instanceof Element ? event.target : null;
  const selection = getSelectionFromTarget(target, videoSelectors.join(','), location.pathname);
  if (!selection || selection.videoId.startsWith('title:')) return;
  const observation = createSelectionObservation(selection, kind);
  const now = Date.now();
  const signature = `${observation.videoId}|${observation.exposureId ?? ''}`;
  if (
    lastSelectionInteraction &&
    lastSelectionInteraction.signature === signature &&
    lastSelectionInteraction.kind !== kind &&
    now - lastSelectionInteraction.at < 750
  ) {
    return;
  }
  lastSelectionInteraction = { signature, kind, at: now };
  pendingWatchExposure = {
    videoId: observation.videoId,
    exposureId: observation.exposureId,
    observedAt: now,
  };
  safeSendMessage({
    type: EXTENSION_MESSAGE_TYPES.SELECTION_OBSERVATION,
    payload: { observation },
  });
};

document.addEventListener('click', (event) => recordSelection(event, 'click'), true);
document.addEventListener('auxclick', (event) => recordSelection(event, 'auxclick'), true);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  recordSelection(event, 'keyboard');
}, true);

scheduleHistoryObservation();
scheduleHomeRecommendationObservation();
