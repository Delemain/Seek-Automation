export class WorkflowError extends Error {
  constructor(public code: string, message: string, public exitCode = 6,
    public status: TerminalStatus = 'failed') { super(message); }
}
export type TerminalStatus = 'prepared' | 'submitted' | 'already_applied' | 'not_found' | 'blocked' | 'failed' | 'submission_uncertain';
export function invalid(message: string): never { throw new WorkflowError('INVALID_CONFIG', message, 2, 'blocked'); }

