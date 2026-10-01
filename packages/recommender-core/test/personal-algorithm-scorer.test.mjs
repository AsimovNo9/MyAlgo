import test from 'node:test';import assert from 'node:assert/strict';import{buildPersonalScoringGraphIndex,isScoreTraceConsistent,replayPersonalAlgorithmScore,scorePersonalAlgorithm,traceContributionTotal}from'../src/personal-algorithm-scorer.ts';
const state={schemaVersion:2,evidence:[{id:'e1',evidence:{kind:'interaction',content:{source:'youtube',externalId:'video-1'},exposureId:'exp-1',interaction:'watched',observedAt:'2026-09-26T10:00:00.000Z',provenance:{connector:'youtube',mechanism:'player_telemetry'}},confidence:1,retainedAt:'2026-09-26T10:00:01.000Z',retention:{policy:'default',expiresAt:null}}],graph:{nodes:[{id:'content:youtube:video-1',kind:'content',label:'Video 1',provenance:'explicit',confidence:1,attributes:{},createdAt:'2026-09-26T10:00:00.000Z',updatedAt:'2026-09-26T10:00:00.000Z'},{id:'creator:youtube:creator-1',kind:'creator',label:'Creator 1',provenance:'inferred',confidence:1,attributes:{},createdAt:'2026-09-26T10:00:00.000Z',updatedAt:'2026-09-26T10:00:00.000Z'}],edges:[{id:'edge:created-by:video-1:creator-1',sourceNodeId:'content:youtube:video-1',targetNodeId:'creator:youtube:creator-1',relation:'created_by',provenance:'inferred',confidence:1,evidenceIds:['e1'],attributes:{},createdAt:'2026-09-26T10:00:00.000Z',updatedAt:'2026-09-26T10:00:00.000Z'}],userEdits:[],revisions:[],currentRevision:7}};
const candidate={id:'candidate-1',content:{source:'youtube',externalId:'video-1'},nodeIds:['content:youtube:video-1'],creatorNodeId:'creator:youtube:creator-1'};
test('additive scoring reconciles exact contributions',()=>{const p={revision:'p1',baseScore:1,nodeWeights:{'content:youtube:video-1':2,'creator:youtube:creator-1':3},edgeRelationWeights:{created_by:4},feedback:[{id:'f1',contentId:'video-1',value:-.5,label:'less like this',evidenceIds:['e1']}],modes:{Work:{baseDelta:.25,nodeWeights:{'creator:youtube:creator-1':.75}}}};const r=scorePersonalAlgorithm(state,candidate,p,'Work');assert.equal(r.score,10.5);assert.equal(traceContributionTotal(r.trace),10.5);assert.equal(isScoreTraceConsistent(r.trace),true);assert.equal(r.trace.edgeContributions[0].evidenceIds[0],'e1');assert.equal(r.trace.modeContributions.length,2)});
test('exclusion and eligibility happen before scoring',()=>{const p={revision:'p2',baseScore:100,exclusions:{creatorNodeIds:['creator:youtube:creator-1']},eligibility:{requiredNodeIds:['missing']}};const r=scorePersonalAlgorithm(state,candidate,p);assert.equal(r.trace.policyOutcome,'excluded');assert.equal(r.score,0);assert.equal(r.trace.nodeContributions.length,0)});
test('suppression is represented as a contribution',()=>{const p={revision:'p3',baseScore:1,nodeWeights:{'content:youtube:video-1':1},suppression:{belowScore:5}};const r=scorePersonalAlgorithm(state,candidate,p);assert.equal(r.trace.policyOutcome,'suppressed');assert.equal(r.score,0);assert.equal(r.trace.suppressionContributions[0].value,-2);assert.equal(isScoreTraceConsistent(r.trace),true)});
test('replay reproduces score and trace identity',()=>{const p={revision:'p4',baseScore:2,nodeWeights:{'content:youtube:video-1':3}};const a=scorePersonalAlgorithm(state,candidate,p),b=replayPersonalAlgorithmScore(state,candidate,p);assert.equal(b.score,a.score);assert.equal(b.trace.id,a.trace.id);assert.equal(b.trace.graphRevision,7);assert.equal(b.trace.evidenceRevision,a.trace.evidenceRevision)});
test('feedback changes trace identity',()=>{const p={revision:'p-feedback',baseScore:1};const a=scorePersonalAlgorithm(state,candidate,p,'default',[]),b=scorePersonalAlgorithm(state,candidate,p,'default',[{id:'f1',contentId:'video-1',value:2}]);assert.notEqual(a.trace.id,b.trace.id);assert.notEqual(a.score,b.score)});
test('insertion order does not change trace',()=>{const p={revision:'p5',edgeRelationWeights:{created_by:2}};const reversed={...state,graph:{...state.graph,nodes:[...state.graph.nodes].reverse(),edges:[...state.graph.edges].reverse()}};const a=scorePersonalAlgorithm(state,candidate,p),b=scorePersonalAlgorithm(reversed,candidate,p);assert.equal(b.trace.id,a.trace.id);assert.deepEqual(b.trace.edgeContributions,a.trace.edgeContributions)});

test('decimal semantic-style contributions reconcile exactly',()=>{const p={revision:'p-decimal',baseScore:.1};const decimalCandidate={...candidate,features:[{id:'semantic:graph',label:'semantic match: personal graph',value:.2},{id:'semantic:mode',label:'semantic match: active mode',value:.3}]};const r=scorePersonalAlgorithm(state,decimalCandidate,p);assert.equal(r.score,.6);assert.equal(traceContributionTotal(r.trace),.6);assert.equal(isScoreTraceConsistent(r.trace),true)});
test('candidate mode features land in mode contributions with exact graph grounding',()=>{
  const p={revision:'p-mode-grounded'};
  const groundedCandidate={
    ...candidate,
    modeFeatures:[{
      id:'durable:mode:systems:r2:canonical:crdts',
      label:'mode: Distributed systems → canonical concept: CRDTs',
      value:3.5,
      sourceId:'canonical:crdts',
      sourceIds:['topic:crdts','topic:replication'],
      evidenceIds:['e1'],
      modeId:'mode:systems',
      modeRevision:2,
      canonicalId:'canonical:crdts',
    }],
  };
  const r=scorePersonalAlgorithm(state,groundedCandidate,p,'Distributed systems');
  assert.equal(r.score,3.5);
  assert.equal(r.trace.featureContributions.length,0);
  assert.equal(r.trace.modeContributions.length,1);
  assert.deepEqual(r.trace.modeContributions[0],{
    id:'mode-feature:durable:mode:systems:r2:canonical:crdts',
    kind:'mode',
    label:'mode: Distributed systems → canonical concept: CRDTs',
    value:3.5,
    sourceId:'canonical:crdts',
    sourceIds:['topic:crdts','topic:replication'],
    evidenceIds:['e1'],
    modeId:'mode:systems',
    modeRevision:2,
    canonicalId:'canonical:crdts',
  });
  assert.equal(traceContributionTotal(r.trace),3.5);
  assert.equal(isScoreTraceConsistent(r.trace),true);
});

test('preindexed graph scoring is trace-identical to full edge scans',()=>{const p={revision:'p-index',baseScore:1,nodeWeights:{'content:youtube:video-1':2,'creator:youtube:creator-1':3},edgeRelationWeights:{created_by:4}};const revisionContext=undefined;const indexed=scorePersonalAlgorithm(state,candidate,p,'default',[],revisionContext,buildPersonalScoringGraphIndex(state));const scanned=scorePersonalAlgorithm(state,candidate,p,'default',[]);assert.equal(indexed.score,scanned.score);assert.equal(indexed.trace.id,scanned.trace.id);assert.deepEqual(indexed.trace.edgeContributions,scanned.trace.edgeContributions);assert.deepEqual(indexed.trace.matchedPaths,scanned.trace.matchedPaths)});

test('graph controls reduce and prefer exact sourced contributions',()=>{
  const p={
    revision:'p-controls',
    nodeWeights:{'creator:youtube:creator-1':8},
    graphControls:[{
      id:'control:node:creator',
      targetKind:'node',
      targetId:'creator:youtube:creator-1',
      action:'reduce'
    }]
  };
  const reduced=scorePersonalAlgorithm(state,candidate,p);
  assert.equal(reduced.score,4);
  assert.equal(reduced.trace.nodeContributions[0].value,4);
  assert.deepEqual(reduced.trace.nodeContributions[0].controlIds,['control:node:creator']);
  assert.match(reduced.trace.nodeContributions[0].label,/reduce by you/);
  assert.equal(isScoreTraceConsistent(reduced.trace),true);

  const preferred=scorePersonalAlgorithm(state,candidate,{
    ...p,
    graphControls:[{
      id:'control:node:creator',
      targetKind:'node',
      targetId:'creator:youtube:creator-1',
      action:'prefer'
    }]
  });
  assert.equal(preferred.score,12);
  assert.equal(preferred.trace.nodeContributions[0].value,12);
  assert.match(preferred.trace.nodeContributions[0].label,/prefer by you/);
  assert.equal(isScoreTraceConsistent(preferred.trace),true);
});

test('mute graph control hard-suppresses a matching node before final presentation',()=>{
  const result=scorePersonalAlgorithm(state,candidate,{
    revision:'p-mute',
    nodeWeights:{'creator:youtube:creator-1':8},
    graphControls:[{
      id:'control:node:creator',
      targetKind:'node',
      targetId:'creator:youtube:creator-1',
      action:'mute'
    }]
  });
  assert.equal(result.score,0);
  assert.equal(result.trace.policyOutcome,'suppressed');
  assert.equal(result.trace.suppressed,true);
  assert.equal(result.trace.suppressionContributions.length,1);
  assert.match(result.trace.suppressionContributions[0].label,/graph_control/);
  assert.equal(isScoreTraceConsistent(result.trace),true);
});

test('edge controls affect only the exact matched score-bearing edge',()=>{
  const policy={
    revision:'p-edge-control',
    edgeRelationWeights:{created_by:4},
    graphControls:[{
      id:'control:edge:creator',
      targetKind:'edge',
      targetId:'edge:created-by:video-1:creator-1',
      action:'reduce'
    }]
  };
  const result=scorePersonalAlgorithm(state,candidate,policy);
  assert.equal(result.score,2);
  assert.equal(result.trace.edgeContributions[0].value,2);
  assert.deepEqual(result.trace.edgeContributions[0].controlIds,['control:edge:creator']);
  assert.equal(isScoreTraceConsistent(result.trace),true);
});
