// Worker thread entry for the pool in pool.ts.
import { runTask, type Task } from './tasks.ts';

export default function (task: Task) {
  return runTask(task);
}
