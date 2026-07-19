export interface StoredRun {
  test: string;
  suite: string;
  passed: boolean;
  output: string;
  timestamp: string;
  wake?: string;
}

export interface DiffEntry {
  test: string;
  suite: string;
  status: 'regression' | 'improvement' | 'changed' | 'new' | 'removed';
  old_output: string;
  new_output: string;
  old_passed: boolean;
  new_passed: boolean;
  summary: string;
}