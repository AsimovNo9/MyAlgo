export async function classifyContent(_title: string) {
  return {
    topics: ['AI'],
    content_type: 'tutorial',
    quality_score: 90,
    reasoning: 'Stub classification result',
  };
}
