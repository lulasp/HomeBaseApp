const mockSchedule = jest.fn().mockResolvedValue('scheduled-id');
const mockCancel = jest.fn().mockResolvedValue(undefined);
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockSetChannel = jest.fn().mockResolvedValue(undefined);
const mockSetHandler = jest.fn();

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: (...args) => mockSchedule(...args),
  cancelScheduledNotificationAsync: (...args) => mockCancel(...args),
  getPermissionsAsync: (...args) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args) => mockRequestPermissions(...args),
  setNotificationChannelAsync: (...args) => mockSetChannel(...args),
  setNotificationHandler: (...args) => mockSetHandler(...args),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { HIGH: 4 },
}));

import { Platform } from 'react-native';
import {
  remindersSupported,
  ensureNotificationPermission,
  scheduleTodoReminder,
  cancelTodoReminder,
  syncTodoReminders,
} from '../services/notifications';

const WEEK = '2026-09-07';           // a Monday
const UID = 'user-1';
const NOW = new Date(2026, 8, 9, 12, 0);   // Wed 09 Sep, midday

const todo = (overrides = {}) => ({
  id: 't1',
  weekKey: WEEK,
  day: 'Wednesday',
  text: 'Take the bins out',
  done: false,
  remindTime: '18:30',
  remindFor: UID,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
});

describe('remindersSupported', () => {
  it('is true on native', () => {
    expect(remindersSupported()).toBe(true);
  });

  it('is false on web, where expo-notifications has no implementation', () => {
    Platform.OS = 'web';
    expect(remindersSupported()).toBe(false);
  });
});

describe('ensureNotificationPermission', () => {
  it('does not prompt again when permission is already granted', async () => {
    mockGetPermissions.mockResolvedValue({ granted: true });
    await expect(ensureNotificationPermission()).resolves.toBe(true);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('requests permission when it has not been granted yet', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ granted: true });
    await expect(ensureNotificationPermission()).resolves.toBe(true);
    expect(mockRequestPermissions).toHaveBeenCalled();
  });

  it('reports failure when the request is denied', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ granted: false });
    await expect(ensureNotificationPermission()).resolves.toBe(false);
  });

  it('does not prompt when the user has permanently declined', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(ensureNotificationPermission()).resolves.toBe(false);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('creates the Android channel once permission is held', async () => {
    Platform.OS = 'android';
    mockGetPermissions.mockResolvedValue({ granted: true });
    await ensureNotificationPermission();
    expect(mockSetChannel).toHaveBeenCalledWith('todo-reminders', expect.objectContaining({
      name: 'Task reminders',
    }));
  });

  it('does not touch channels on iOS', async () => {
    mockGetPermissions.mockResolvedValue({ granted: true });
    await ensureNotificationPermission();
    expect(mockSetChannel).not.toHaveBeenCalled();
  });

  it('is a no-op on web', async () => {
    Platform.OS = 'web';
    await expect(ensureNotificationPermission()).resolves.toBe(false);
    expect(mockGetPermissions).not.toHaveBeenCalled();
  });
});

describe('scheduleTodoReminder', () => {
  it('schedules at the derived date, keyed by the todo id', async () => {
    await scheduleTodoReminder(todo());
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const request = mockSchedule.mock.calls[0][0];
    expect(request.identifier).toBe('t1');
    expect(request.content.body).toBe('Take the bins out');
    expect(request.trigger.type).toBe('date');
    expect(request.trigger.date.getDate()).toBe(9);
    expect(request.trigger.date.getHours()).toBe(18);
    expect(request.trigger.date.getMinutes()).toBe(30);
  });

  it('routes through the Android channel only on Android', async () => {
    await scheduleTodoReminder(todo());
    expect(mockSchedule.mock.calls[0][0].content.channelId).toBeUndefined();

    Platform.OS = 'android';
    await scheduleTodoReminder(todo());
    expect(mockSchedule.mock.calls[1][0].content.channelId).toBe('todo-reminders');
  });

  it('does not schedule when the reminder time is unusable', async () => {
    await expect(scheduleTodoReminder(todo({ remindTime: 'later' }))).resolves.toBeNull();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('is a no-op on web', async () => {
    Platform.OS = 'web';
    await expect(scheduleTodoReminder(todo())).resolves.toBeNull();
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('cancelTodoReminder', () => {
  it('cancels by todo id', async () => {
    await cancelTodoReminder('t1');
    expect(mockCancel).toHaveBeenCalledWith('t1');
  });

  it('swallows a cancel for an identifier that was never scheduled', async () => {
    mockCancel.mockRejectedValueOnce(new Error('not found'));
    await expect(cancelTodoReminder('t1')).resolves.toBeUndefined();
  });
});

describe('syncTodoReminders', () => {
  it('schedules a newly set reminder and remembers it', async () => {
    const next = await syncTodoReminders([todo()], UID, new Map(), NOW);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(next.get('t1')).toBeTruthy();
  });

  it('does nothing on a second pass when nothing changed', async () => {
    const first = await syncTodoReminders([todo()], UID, new Map(), NOW);
    mockSchedule.mockClear();
    const second = await syncTodoReminders([todo()], UID, first, NOW);
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(second.get('t1')).toBe(first.get('t1'));
  });

  it('re-schedules when the time changes', async () => {
    const first = await syncTodoReminders([todo()], UID, new Map(), NOW);
    mockSchedule.mockClear();
    await syncTodoReminders([todo({ remindTime: '19:45' })], UID, first, NOW);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule.mock.calls[0][0].trigger.date.getHours()).toBe(19);
  });

  it('re-schedules when the task moves to another day', async () => {
    const first = await syncTodoReminders([todo()], UID, new Map(), NOW);
    mockSchedule.mockClear();
    await syncTodoReminders([todo({ day: 'Friday' })], UID, first, NOW);
    expect(mockSchedule.mock.calls[0][0].trigger.date.getDate()).toBe(11);
  });

  it('cancels when the task is completed', async () => {
    const first = await syncTodoReminders([todo()], UID, new Map(), NOW);
    const next = await syncTodoReminders([todo({ done: true })], UID, first, NOW);
    expect(mockCancel).toHaveBeenCalledWith('t1');
    expect(next.has('t1')).toBe(false);
  });

  it('cancels when the reminder is cleared', async () => {
    const first = await syncTodoReminders([todo()], UID, new Map(), NOW);
    await syncTodoReminders([todo({ remindTime: null })], UID, first, NOW);
    expect(mockCancel).toHaveBeenCalledWith('t1');
  });

  it('cancels when the task disappears from the list', async () => {
    const first = await syncTodoReminders([todo()], UID, new Map(), NOW);
    const next = await syncTodoReminders([], UID, first, NOW);
    expect(mockCancel).toHaveBeenCalledWith('t1');
    expect(next.size).toBe(0);
  });

  it('ignores reminders another member set', async () => {
    await syncTodoReminders([todo({ remindFor: 'user-2' })], UID, new Map(), NOW);
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('ignores a reminder whose time has already passed', async () => {
    const late = new Date(2026, 8, 9, 19, 0);
    await syncTodoReminders([todo()], UID, new Map(), late);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('forgets a todo whose scheduling failed, so the next sync retries it', async () => {
    mockSchedule.mockRejectedValueOnce(new Error('quota exceeded'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const next = await syncTodoReminders([todo()], UID, new Map(), NOW);
    expect(next.has('t1')).toBe(false);

    mockSchedule.mockClear();
    await syncTodoReminders([todo()], UID, next, NOW);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    console.error.mockRestore();
  });

  it('handles several todos independently', async () => {
    const todos = [
      todo({ id: 'a' }),
      todo({ id: 'b', done: true }),
      todo({ id: 'c', remindFor: 'user-2' }),
    ];
    const next = await syncTodoReminders(todos, UID, new Map(), NOW);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule.mock.calls[0][0].identifier).toBe('a');
    expect([...next.keys()]).toEqual(['a']);
  });

  it('is a no-op on web and leaves the known map untouched', async () => {
    Platform.OS = 'web';
    const known = new Map([['t1', 'sig']]);
    await expect(syncTodoReminders([todo()], UID, known, NOW)).resolves.toBe(known);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});
