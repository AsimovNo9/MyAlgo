export type NeuralSchedulerJobKind = 'concept' | 'embedding';
export type NeuralSchedulerStepResult = 'done' | 'yield';

export type NeuralSchedulerJob = {
  id: string;
  kind: NeuralSchedulerJobKind;
  step(): Promise<NeuralSchedulerStepResult>;
  onDone?(): void;
  onError?(error: unknown): void;
};

export type PriorityNeuralScheduler = {
  enqueue(job: NeuralSchedulerJob): boolean;
  isQueued(id: string): boolean;
};

export function createPriorityNeuralScheduler(
  yieldControl: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
): PriorityNeuralScheduler {
  const conceptQueue: NeuralSchedulerJob[] = [];
  const embeddingQueue: NeuralSchedulerJob[] = [];
  const queuedIds = new Set<string>();
  let running = false;

  const pump = async () => {
    if (running) return;
    running = true;

    try {
      while (conceptQueue.length > 0 || embeddingQueue.length > 0) {
        const job = conceptQueue.shift() ?? embeddingQueue.shift();
        if (!job) continue;

        try {
          const result = await job.step();
          if (result === 'yield' && job.kind === 'embedding') {
            embeddingQueue.push(job);
            // Yield to the browser task queue so a newly posted concept request
            // can be observed before the next embedding batch starts.
            await yieldControl();
            continue;
          }

          queuedIds.delete(job.id);
          job.onDone?.();
        } catch (error) {
          queuedIds.delete(job.id);
          job.onError?.(error);
        }
      }
    } finally {
      running = false;
      if (conceptQueue.length > 0 || embeddingQueue.length > 0) {
        void pump();
      }
    }
  };

  return {
    enqueue(job) {
      if (queuedIds.has(job.id)) return false;
      queuedIds.add(job.id);
      if (job.kind === 'concept') conceptQueue.push(job);
      else embeddingQueue.push(job);
      void pump();
      return true;
    },

    isQueued(id) {
      return queuedIds.has(id);
    },
  };
}
