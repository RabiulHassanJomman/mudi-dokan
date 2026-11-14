/**
 * The nightly backup, daily retention and pending uploads while the app is closed:
 * expo-background-task (Android WorkManager), every few hours when the phone allows.
 * defineTask must run at startup (imported by the root layout).
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { runInBackground } from './app';

export const DRIVE_TASK = 'mudi-dokan-drive';
/** Minutes. Nightly backup is "after 9 pm"; a 3-hour wake-up gets it done that night. */
const EVERY_MIN = 180;

TaskManager.defineTask(DRIVE_TASK, async () => {
  try {
    await runInBackground();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('drive background', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerDriveTask(): Promise<void> {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(DRIVE_TASK)) return;
    await BackgroundTask.registerTaskAsync(DRIVE_TASK, { minimumInterval: EVERY_MIN });
  } catch (e) {
    console.warn('drive task register', e);
  }
}
