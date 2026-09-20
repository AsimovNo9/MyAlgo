'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Algorithm, AlgorithmActivationResponse, AlgorithmPayload, RuleType, TopicWeight } from '@repo/shared-types';

type Preset = {
  name: string;
  goal_text: string;
  language?: string;
  preferred_formats?: string[];
  topic_weights: TopicWeight[];
  rules: Array<{ type: RuleType; condition_text: string }>;
};

const presetOptions: Preset[] = [
  {
    name: 'AI Work',
    goal_text: 'Learn AI agents and shipping decisions.',
    topic_weights: [
      { topic: 'AI', weight: 90 },
      { topic: 'Productivity', weight: 75 },
      { topic: 'Business', weight: 60 },
      { topic: 'Engineering', weight: 70 },
    ],
    rules: [
      { type: 'always_show', condition_text: 'AI agent tutorials' },
      { type: 'priority', condition_text: 'AI agents' },
      { type: 'never_show', condition_text: 'celebrity gossip' },
    ],
  },
  {
    name: 'Deep Work',
    goal_text: 'Cut distractions and improve focus.',
    topic_weights: [
      { topic: 'Productivity', weight: 92 },
      { topic: 'Business', weight: 55 },
      { topic: 'Tutorial', weight: 60 },
    ],
    rules: [
      { type: 'always_show', condition_text: 'deep work' },
      { type: 'priority', condition_text: 'focus systems' },
      { type: 'never_show', condition_text: 'entertainment gossip' },
    ],
  },
  {
    name: 'Startup Pulse',
    goal_text: 'Catch product, strategy, and founder insights.',
    topic_weights: [
      { topic: 'Business', weight: 90 },
      { topic: 'Productivity', weight: 65 },
      { topic: 'AI', weight: 60 },
    ],
    rules: [
      { type: 'always_show', condition_text: 'founder stories' },
      { type: 'priority', condition_text: 'startup strategy' },
      { type: 'never_show', condition_text: 'celebrity drama' },
    ],
  },
  {
    name: 'Nature & Travel',
    goal_text: 'Explore landscapes, wellbeing, and slow living.',
    topic_weights: [
      { topic: 'Nature', weight: 90 },
      { topic: 'Productivity', weight: 35 },
      { topic: 'Tutorial', weight: 45 },
      { topic: 'Business', weight: 20 },
    ],
    rules: [
      { type: 'always_show', condition_text: 'nature documentaries' },
      { type: 'priority', condition_text: 'travel guides' },
      { type: 'never_show', condition_text: 'clickbait drama' },
    ],
  },
  {
    name: 'Learning Loop',
    goal_text: 'Keep learning across skills, science, and curiosity.',
    topic_weights: [
      { topic: 'Tutorial', weight: 90 },
      { topic: 'Engineering', weight: 70 },
      { topic: 'AI', weight: 60 },
      { topic: 'Business', weight: 50 },
    ],
    rules: [
      { type: 'always_show', condition_text: 'how to learn' },
      { type: 'priority', condition_text: 'study guides' },
      { type: 'never_show', condition_text: 'gossip reels' },
    ],
  },
  {
    name: 'Drive & Life',
    goal_text: 'Mix practical driving, culture, and everyday life.',
    topic_weights: [
      { topic: 'Driving', weight: 92 },
      { topic: 'Tutorial', weight: 70 },
      { topic: 'Productivity', weight: 45 },
      { topic: 'Lifestyle', weight: 62 },
    ],
    rules: [
      { type: 'always_show', condition_text: 'driving tips' },
      { type: 'priority', condition_text: 'road trip advice' },
      { type: 'never_show', condition_text: 'celebrity breakups' },
    ],
  },
  {
    name: 'Curious Mind',
    goal_text: 'Mix science, philosophy, and creative learning.',
    topic_weights: [
      { topic: 'Learning', weight: 88 },
      { topic: 'Science', weight: 83 },
      { topic: 'Education', weight: 78 },
      { topic: 'Creativity', weight: 60 },
    ],
    rules: [
      { type: 'always_show', condition_text: 'scientific explainers' },
      { type: 'priority', condition_text: 'learning breakdowns' },
      { type: 'never_show', condition_text: 'tabloid news' },
    ],
  },
];

const emptyPayload: Omit<AlgorithmPayload, 'id'> = {
  name: 'Work',
  is_active: true,
  goal_text: 'Learn AI agents and shipping decisions.',
  language: 'en',
  preferred_formats: ['tutorial'],
  topic_weights: presetOptions[0].topic_weights,
  rules: presetOptions[0].rules.map((rule) => ({ ...rule })),
};

const defaultRuleTemplates = [
  { type: 'always_show' as const, label: 'AI agent tutorials' },
  { type: 'priority' as const, label: 'AI agents' },
  { type: 'priority' as const, label: 'focus systems' },
  { type: 'never_show' as const, label: 'celebrity gossip' },
  { type: 'never_show' as const, label: 'entertainment drama' },
  { type: 'always_show' as const, label: 'founder stories' },
];

const ruleTypeOptions: RuleType[] = ['priority', 'always_show', 'never_show'];

const formatRuleType = (type: RuleType) => {
  if (type === 'always_show') return 'Always show';
  if (type === 'never_show') return 'Never show';
  return 'Priority';
};

const defaultTopicCatalog = ['AI', 'Productivity', 'Business', 'Engineering', 'Tutorial', 'Nature', 'Learning', 'Driving', 'Education', 'Science', 'Lifestyle', 'Creativity'];
const formatOptions = ['tutorial', 'review', 'deep analysis', 'developer commentary', 'news', 'long-form'];

export default function AlgorithmsPage() {
  const [algorithms, setAlgorithms] = useState<Algorithm[]>([]);
  const [form, setForm] = useState(emptyPayload);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedPresetName, setSelectedPresetName] = useState('AI Work');
  const [hoveredPreset, setHoveredPreset] = useState<string | null>(null);
  const [hoveredRule, setHoveredRule] = useState<string | null>(null);
  const [customRuleText, setCustomRuleText] = useState('');
  const [customRuleType, setCustomRuleType] = useState<RuleType>('priority');
  const [editingRuleIndex, setEditingRuleIndex] = useState<number | null>(null);
  const [customTopicText, setCustomTopicText] = useState('');
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [activationStatus, setActivationStatus] = useState<string | null>(null);

  useEffect(() => {
    void fetchAlgorithms();
  }, []);

  const fetchAlgorithms = async () => {
    const response = await fetch('/api/algorithms');
    if (!response.ok) return;

    const data = (await response.json()) as Algorithm[];
    setAlgorithms(data);
  };

  const activeAlgorithm = algorithms.find((algorithm) => algorithm.is_active) ?? algorithms[0];

  const hasRule = useMemo(
    () => (condition_text: string) => form.rules.some((rule) => rule.condition_text.toLowerCase() === condition_text.toLowerCase()),
    [form.rules],
  );

  const applyPreset = (preset: Preset) => {
    setSelectedPresetName(preset.name);
    setForm({
      name: preset.name,
      is_active: true,
      goal_text: preset.goal_text,
      language: preset.language ?? 'en',
      preferred_formats: preset.preferred_formats ?? ['tutorial'],
      topic_weights: preset.topic_weights.map((item) => ({ ...item })),
      rules: preset.rules.map((rule, index) => ({ id: `preset-rule-${index}`, ...rule })),
    });
  };

  const handleWeightChange = (topic: string, delta: number) => {
    setForm((current) => {
      const nextWeights = [...current.topic_weights];
      const existing = nextWeights.find((weight) => weight.topic === topic);

      if (existing) {
        existing.weight = Math.min(100, Math.max(0, existing.weight + delta));
      } else {
        nextWeights.push({ topic, weight: Math.max(0, delta) });
      }

      return { ...current, topic_weights: nextWeights };
    });
  };

  const addCustomTopic = () => {
    const value = customTopicText.trim();
    if (!value) return;

    setForm((current) => {
      const normalized = value.charAt(0).toUpperCase() + value.slice(1);
      const exists = current.topic_weights.some((weight) => weight.topic.toLowerCase() === normalized.toLowerCase());
      if (exists) {
        return current;
      }

      return {
        ...current,
        topic_weights: [...current.topic_weights, { topic: normalized, weight: 60 }],
      };
    });
    setCustomTopicText('');
  };

  const removeTopic = (topic: string) => {
    setForm((current) => ({
      ...current,
      topic_weights: current.topic_weights.filter((weight) => weight.topic.toLowerCase() !== topic.toLowerCase()),
    }));
  };

  const toggleFormat = (format: string) => {
    setForm((current) => {
      const formats = current.preferred_formats ?? [];
      return {
        ...current,
        preferred_formats: formats.includes(format)
          ? formats.filter((item) => item !== format)
          : [...formats, format],
      };
    });
  };

  const toggleRuleTemplate = (template: { type: RuleType; label: string }) => {
    setForm((current) => {
      const existingIndex = current.rules.findIndex((rule) => rule.condition_text.toLowerCase() === template.label.toLowerCase());
      if (existingIndex >= 0) {
        return { ...current, rules: current.rules.filter((_, index) => index !== existingIndex) };
      }

      return {
        ...current,
        rules: [
          ...current.rules,
          { id: `custom-rule-${Date.now()}`, type: template.type, condition_text: template.label },
        ],
      };
    });
  };

  const addCustomRule = () => {
    const value = customRuleText.trim();
    if (!value) return;

    setForm((current) => ({
      ...current,
      rules: [
        ...current.rules,
        { id: `custom-rule-${Date.now()}`, type: customRuleType, condition_text: value },
      ],
    }));
    setCustomRuleText('');
  };

  const updateRuleText = (index: number, nextText: string) => {
    setForm((current) => ({
      ...current,
      rules: current.rules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, condition_text: nextText } : rule,
      ),
    }));
  };

  const updateRuleType = (index: number, nextType: RuleType) => {
    setForm((current) => ({
      ...current,
      rules: current.rules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, type: nextType } : rule,
      ),
    }));
  };

  const handleCreate = async () => {
    setSaving(true);

    try {
      const response = await fetch('/api/algorithms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (response.ok) {
        const algorithm = await response.json() as Algorithm;
        if (algorithm.id) {
          await handleActivate(algorithm);
        }
        setSelectedPresetName('');
        setForm({
          name: 'Work',
          is_active: true,
          goal_text: 'Learn AI agents and shipping decisions.',
          language: 'en',
          preferred_formats: ['tutorial'],
          topic_weights: presetOptions[0].topic_weights,
          rules: presetOptions[0].rules.map((rule) => ({ ...rule })),
        });
        await fetchAlgorithms();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (algorithm: Algorithm) => {
    if (!algorithm.id) return;
    setActivatingId(algorithm.id);
    setActivationStatus('Using the shared library and finding more if needed…');

    try {
      const response = await fetch('/api/algorithms/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ algorithmId: algorithm.id }),
      });
      const result = await response.json() as AlgorithmActivationResponse;
      if (!response.ok) throw new Error(result.error ?? 'Unable to activate algorithm.');
      setActivationStatus(result.tier === 0
        ? `Using ${result.poolCount} items from the shared library.`
        : result.tier === 1
          ? `Added trusted-channel content; ${result.poolCount} items are ready.`
          : `Expanded this topic; ${result.poolCount} items are ready.`);
      await fetchAlgorithms();
    } catch (error) {
      setActivationStatus(error instanceof Error ? error.message : 'Unable to activate algorithm.');
    } finally {
      setActivatingId(null);
    }
  };

  const handleDelete = async (algorithm: Algorithm) => {
    if (!algorithm.id || !window.confirm(`Delete "${algorithm.name}"?`)) return;

    setDeletingId(algorithm.id);
    setDeleteError(null);

    try {
      const response = await fetch('/api/algorithms', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: algorithm.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to delete algorithm.');
      }

      await fetchAlgorithms();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Unable to delete algorithm.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main style={{
      display: 'grid',
      gap: 20,
      padding: '28px 24px 40px',
      maxWidth: 1200,
      margin: '0 auto',
      background: 'radial-gradient(circle at top, rgba(148,163,184,0.16) 0%, rgba(255,255,255,0) 32%), #f3f6fb',
      minHeight: '100vh',
      color: '#0f172a',
    }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.7, color: '#475569' }}>Preferences</div>
        <h1 style={{ margin: 0, fontSize: 34, letterSpacing: '-0.06em', color: '#0f172a' }}>Algorithms</h1>
      </div>

      <section style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.72) 100%)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        color: '#0f172a',
        borderRadius: 30,
        padding: 22,
        border: '1px solid rgba(148,163,184,0.24)',
        boxShadow: '0 18px 36px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
      }}>
        <h2 style={{ margin: '0 0 18px', fontSize: 28, letterSpacing: '-0.04em', color: '#0f172a' }}>Build a matching feed</h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 22 }}>
          {presetOptions.map((preset) => {
            const isActive = selectedPresetName === preset.name;
            const isHovering = hoveredPreset === preset.name;
            return (
              <button
                key={preset.name}
                type="button"
                onMouseEnter={() => setHoveredPreset(preset.name)}
                onMouseLeave={() => setHoveredPreset(null)}
                onClick={() => applyPreset(preset)}
                style={{
                  borderRadius: 999,
                  padding: '9px 14px',
                  border: isActive ? '1px solid rgba(96,165,250,0.7)' : '1px solid rgba(148,163,184,0.35)',
                  background: isActive ? 'linear-gradient(180deg, #dbeafe 0%, #bfdbfe 100%)' : isHovering ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.6)',
                  color: isActive ? '#1d4ed8' : '#334155',
                  cursor: 'pointer',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  boxShadow: isActive ? '0 8px 20px rgba(96,165,250,0.18)' : 'inset 0 1px 0 rgba(255,255,255,0.5)',
                  transition: 'all 150ms ease',
                  transform: isHovering ? 'translateY(-1px)' : 'translateY(0)',
                }}
              >
                {preset.name}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'grid', gap: 18 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ fontSize: 12, opacity: 0.8 }}>Algorithm name</label>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Work / Learning / Relax"
              style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.7)', color: '#0f172a' }}
            />
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ fontSize: 12, opacity: 0.8 }}>Goal</label>
            <textarea
              value={form.goal_text ?? ''}
              onChange={(event) => setForm((current) => ({ ...current, goal_text: event.target.value || null }))}
              rows={3}
              placeholder="What should this algorithm reward?"
              style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.7)', color: '#0f172a', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(150px, 0.7fr) minmax(0, 1.3fr)', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <label htmlFor="algorithm-language" style={{ fontSize: 12, opacity: 0.8 }}>Language</label>
              <select
                id="algorithm-language"
                value={form.language ?? ''}
                onChange={(event) => setForm((current) => ({ ...current, language: event.target.value || null }))}
                style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.7)', color: '#0f172a' }}
              >
                <option value="">Any language</option>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="ja">Japanese</option>
                <option value="ko">Korean</option>
                <option value="zh">Chinese</option>
              </select>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Preferred formats</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {formatOptions.map((format) => {
                  const selected = (form.preferred_formats ?? []).includes(format);
                  return (
                    <label key={format} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 999, border: selected ? '1px solid #93c5fd' : '1px solid rgba(148,163,184,0.35)', background: selected ? '#dbeafe' : 'rgba(255,255,255,0.55)', color: selected ? '#1d4ed8' : '#334155', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleFormat(format)}
                        style={{ accentColor: '#2563eb' }}
                      />
                      {format}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: 15 }}>Topic priority</strong>
              <span style={{ opacity: 0.7, fontSize: 12 }}>Add or tune topics</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {defaultTopicCatalog.map((topic) => {
                const exists = form.topic_weights.some((item) => item.topic.toLowerCase() === topic.toLowerCase());
                if (!exists) {
                  return (
                    <button
                      key={`default-${topic}`}
                      type="button"
                      onClick={() => handleWeightChange(topic, 50)}
                      style={{
                        borderRadius: 999,
                        padding: '7px 11px',
                        background: 'rgba(148,163,184,0.10)',
                        border: '1px dashed rgba(148,163,184,0.42)',
                        color: '#334155',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      + {topic}
                    </button>
                  );
                }
                return null;
              })}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {form.topic_weights.map((item) => {
                const topic = item.topic;
                const currentWeight = item.weight;
                return (
                  <div key={topic} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: 8,
                    minWidth: 124,
                    padding: '10px 10px 8px',
                    borderRadius: 22,
                    border: '1px solid rgba(148,163,184,0.28)',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(241,245,249,0.88) 100%)',
                    boxShadow: '0 8px 18px rgba(15,23,42,0.06), inset 0 1px 0 rgba(255,255,255,0.9)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <button type="button" onClick={() => handleWeightChange(topic, -10)} style={{
                        borderRadius: '50%',
                        width: 26,
                        height: 26,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        fontSize: 20,
                        lineHeight: 1,
                        cursor: 'pointer',
                        border: '1px solid rgba(148,163,184,0.35)',
                        background: 'rgba(255,255,255,0.5)',
                        color: '#0f172a',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
                      }}>−</button>

                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 58,
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        fontSize: 13,
                        color: '#0f172a',
                        textAlign: 'center',
                      }}>{topic}</span>

                      <button type="button" onClick={() => handleWeightChange(topic, 10)} style={{
                        borderRadius: '50%',
                        width: 26,
                        height: 26,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        fontSize: 20,
                        lineHeight: 1,
                        cursor: 'pointer',
                        border: '1px solid rgba(148,163,184,0.35)',
                        background: 'rgba(255,255,255,0.5)',
                        color: '#0f172a',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
                      }}>+</button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 2 }}>
                      <div style={{
                        flex: 1,
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: '0.06em',
                        textAlign: 'center',
                        color: '#1e3a8a',
                        background: 'linear-gradient(180deg, rgba(191,219,254,0.9) 0%, rgba(191,219,254,0.7) 100%)',
                        padding: '6px 8px',
                      }}>{currentWeight}</div>

                      <button type="button" onClick={() => removeTopic(topic)} style={{
                        borderRadius: '50%',
                        width: 18,
                        height: 18,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        cursor: 'pointer',
                        background: 'rgba(148,163,184,0.12)',
                        color: '#334155',
                        fontSize: 10,
                        lineHeight: 1,
                        border: '1px solid rgba(148,163,184,0.2)',
                      }}>×</button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <input
                value={customTopicText}
                onChange={(event) => setCustomTopicText(event.target.value)}
                placeholder="Add a topic"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: 'rgba(255,255,255,0.72)',
                  color: '#0f172a',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
                }}
              />
              <button
                type="button"
                onClick={addCustomTopic}
                style={{
                  borderRadius: 12,
                  padding: '10px 14px',
                  border: '1px solid rgba(96,165,250,0.35)',
                  background: 'linear-gradient(180deg, #dbeafe 0%, #bfdbfe 100%)',
                  color: '#1d4ed8',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                Add
              </button>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: 15 }}>Rules</strong>
              <span style={{ opacity: 0.7, fontSize: 12 }}>Suggested filters</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {defaultRuleTemplates.map((template) => {
                const isSelected = hasRule(template.label);
                const isHovering = hoveredRule === `${template.type}-${template.label}`;
                return (
                  <button
                    key={`${template.type}-${template.label}`}
                    type="button"
                    onMouseEnter={() => setHoveredRule(`${template.type}-${template.label}`)}
                    onMouseLeave={() => setHoveredRule(null)}
                    onClick={() => toggleRuleTemplate(template)}
                    style={{
                      borderRadius: 999,
                      padding: '8px 12px',
                      border: isSelected ? '1px solid rgba(96,165,250,0.7)' : '1px solid rgba(148,163,184,0.24)',
                      background: isSelected ? 'linear-gradient(180deg, rgba(191,219,254,0.9) 0%, rgba(219,234,254,0.78) 100%)' : isHovering ? 'rgba(255,255,255,0.86)' : 'rgba(255,255,255,0.54)',
                      color: isSelected ? '#1d4ed8' : '#334155',
                      cursor: 'pointer',
                      fontSize: 12,
                      letterSpacing: '-0.01em',
                      transition: 'all 150ms ease',
                      transform: isHovering ? 'translateY(-1px)' : 'translateY(0)',
                      fontWeight: 600,
                      boxShadow: isSelected ? '0 8px 18px rgba(96,165,250,0.12)' : 'inset 0 1px 0 rgba(255,255,255,0.7)',
                    }}
                  >
                    {template.type} · {template.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <input
                value={customRuleText}
                onChange={(event) => setCustomRuleText(event.target.value)}
                placeholder="Add custom rule phrase"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: 'rgba(255,255,255,0.72)',
                  color: '#0f172a',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
                }}
              />
              <select
                value={customRuleType}
                onChange={(event) => setCustomRuleType(event.target.value as RuleType)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: 'rgba(255,255,255,0.72)',
                  color: '#0f172a',
                  minWidth: 150,
                }}
              >
                {ruleTypeOptions.map((type) => (
                  <option key={type} value={type} style={{ color: '#0f172a' }}>
                    {formatRuleType(type)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addCustomRule}
                style={{
                  borderRadius: 12,
                  padding: '10px 14px',
                  border: '1px solid rgba(96,165,250,0.35)',
                  background: 'linear-gradient(180deg, #dbeafe 0%, #bfdbfe 100%)',
                  color: '#1d4ed8',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                Add
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {form.rules.map((rule, index) => {
                const isEditing = editingRuleIndex === index;
                return (
                  <span key={rule.id ?? `${rule.type}-${rule.condition_text}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1px solid rgba(148,163,184,0.24)', background: 'linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(248,250,252,0.82) 100%)', padding: '8px 10px', fontSize: 12, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8)' }}>
                    <select
                      value={rule.type}
                      onChange={(event) => updateRuleType(index, event.target.value as RuleType)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        color: '#334155',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {ruleTypeOptions.map((type) => (
                        <option key={`${rule.id ?? index}-${type}`} value={type} style={{ color: '#0f172a' }}>
                          {formatRuleType(type)}
                        </option>
                      ))}
                    </select>
                    {isEditing ? (
                      <input
                        value={rule.condition_text}
                        onChange={(event) => updateRuleText(index, event.target.value)}
                        onBlur={() => setEditingRuleIndex(null)}
                        autoFocus
                        style={{
                          background: 'transparent',
                          border: 'none',
                          outline: 'none',
                          color: '#0f172a',
                          minWidth: 120,
                        }}
                      />
                    ) : (
                      <>
                        {rule.condition_text}
                      </>
                    )}
                    <button type="button" onClick={() => setEditingRuleIndex((current) => current === index ? null : index)} style={{ borderRadius: 999, width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer', background: 'rgba(148,163,184,0.12)', color: '#334155', fontSize: 10, border: '1px solid rgba(148,163,184,0.18)' }}>✎</button>
                    <button type="button" onClick={() => setForm((current) => ({ ...current, rules: current.rules.filter((_, ruleIndex) => ruleIndex !== index) }))} style={{ borderRadius: '50%', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer', background: 'rgba(148,163,184,0.12)', color: '#334155', border: '1px solid rgba(148,163,184,0.18)' }}>×</button>
                  </span>
                );
              })}
            </div>
          </div>

          <button
            onClick={() => void handleCreate()}
            disabled={saving}
            style={{
              padding: '12px 18px',
              borderRadius: 14,
              border: '1px solid rgba(34,197,94,0.2)',
              background: 'linear-gradient(180deg, #dcfce7 0%, #bbf7d0 100%)',
              color: '#166534',
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: '-0.02em',
              boxShadow: '0 10px 22px rgba(34,197,94,0.12)',
              transition: 'transform 150ms ease, box-shadow 150ms ease',
            }}
          >
            {saving ? 'Saving…' : 'Save algorithm'}
          </button>
        </div>
      </section>

      <section style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.75) 0%, rgba(248,250,252,0.74) 100%)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderRadius: 24, padding: 20, border: '1px solid rgba(148,163,184,0.2)', boxShadow: '0 10px 28px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255,255,255,0.9)' }}>
        <h2 style={{ marginTop: 0, color: '#0f172a', letterSpacing: '-0.04em' }}>Saved algorithms</h2>
        {activeAlgorithm ? <p style={{ color: '#334155' }}>Active mode: {activeAlgorithm.name}</p> : <p style={{ color: '#334155' }}>No algorithms yet.</p>}
        {activationStatus ? <p style={{ color: '#334155' }}>{activationStatus}</p> : null}
        {deleteError ? <p style={{ color: '#b91c1c' }}>{deleteError}</p> : null}
        <div style={{ display: 'grid', gap: 12 }}>
          {algorithms.map((algorithm) => (
            <div key={algorithm.id ?? algorithm.name} style={{ border: '1px solid rgba(148,163,184,0.28)', borderRadius: 16, padding: 14, background: 'rgba(255,255,255,0.75)' }}>
              <strong style={{ color: '#0f172a' }}>{algorithm.name}</strong>
              {algorithm.goal_text ? <div style={{ marginTop: 4, color: '#475569' }}>{algorithm.goal_text}</div> : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {algorithm.topic_weights?.map((item) => (
                  <span key={`${algorithm.id ?? algorithm.name}-${item.topic}`} style={{ background: '#e0f2fe', color: '#082f49', borderRadius: 999, padding: '6px 8px', fontSize: 12, fontWeight: 600 }}>
                    {item.topic}: {item.weight}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {algorithm.rules?.map((rule) => (
                  <span key={`${algorithm.id ?? algorithm.name}-${rule.type}-${rule.condition_text}`} style={{ background: '#f3f4f6', color: '#111827', borderRadius: 999, padding: '6px 8px', fontSize: 12 }}>
                    {rule.type}: {rule.condition_text}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void handleActivate(algorithm)}
                disabled={!algorithm.id || activatingId !== null}
                style={{ marginTop: 14, marginRight: 8, border: '1px solid #bfdbfe', background: algorithm.is_active ? '#dbeafe' : '#eff6ff', color: '#1d4ed8', borderRadius: 10, padding: '8px 12px', cursor: activatingId !== null ? 'wait' : 'pointer', fontWeight: 700 }}
              >
                {activatingId === algorithm.id ? 'Finding content…' : algorithm.is_active ? 'Active' : 'Activate'}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(algorithm)}
                disabled={deletingId !== null}
                style={{ marginTop: 14, border: '1px solid #fecaca', background: '#fff1f2', color: '#b91c1c', borderRadius: 10, padding: '8px 12px', cursor: deletingId !== null ? 'wait' : 'pointer', fontWeight: 700 }}
              >
                {deletingId === algorithm.id ? 'Deleting…' : 'Delete algorithm'}
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
