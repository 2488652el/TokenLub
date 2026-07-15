import type { AuditEventInput, ControlEventInput } from './phase1'

export type DataTaskType = 'export' | 'delete'
export type DataTaskStatus = 'pending' | 'running' | 'completed' | 'failed'

export type DataTask = {
  id: string
  userId: string
  type: DataTaskType
  status: DataTaskStatus
  result: Record<string, unknown> | null
  errorCode: string | null
  requestedAt: string
  completedAt: string | null
}

export type DataControlStore = {
  createDataTask(input: {
    userId: string
    type: DataTaskType
    requestedAt: string
  }): Promise<DataTask>
  getDataTask(userId: string, taskId: string): Promise<DataTask | undefined>
  setDataTaskStatus(input: {
    taskId: string
    status: Exclude<DataTaskStatus, 'pending'>
    result?: Record<string, unknown> | null
    errorCode?: string | null
    completedAt?: string | null
  }): Promise<void>
  exportUserData(userId: string): Promise<Record<string, unknown>>
  deleteUserData(userId: string): Promise<void>
  appendAuditEvent?(event: AuditEventInput): Promise<void>
  appendControlEvent?(event: ControlEventInput): Promise<void>
}

export class DataControlService {
  constructor(
    private readonly store: DataControlStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  async request(userId: string, type: DataTaskType): Promise<DataTask> {
    const task = await this.store.createDataTask({
      userId,
      type,
      requestedAt: this.now().toISOString()
    })
    void this.run(task).catch(() => undefined)
    return task
  }

  get(userId: string, taskId: string): Promise<DataTask | undefined> {
    return this.store.getDataTask(userId, taskId)
  }

  private async run(task: DataTask): Promise<void> {
    await this.store.setDataTaskStatus({ taskId: task.id, status: 'running' })
    try {
      if (task.type === 'export') {
        const result = await this.store.exportUserData(task.userId)
        await this.store.setDataTaskStatus({
          taskId: task.id,
          status: 'completed',
          result,
          completedAt: this.now().toISOString()
        })
        await this.store.appendAuditEvent?.({
          actorType: 'user',
          actorId: task.userId,
          userId: task.userId,
          eventType: 'data.export_completed',
          metadata: { taskId: task.id },
          createdAt: this.now().toISOString()
        })
        return
      }

      await this.store.deleteUserData(task.userId)
      await this.store.setDataTaskStatus({
        taskId: task.id,
        status: 'completed',
        completedAt: this.now().toISOString()
      })
      await this.store.appendControlEvent?.({
        userId: task.userId,
        type: 'cloud_data_deleted',
        payload: { taskId: task.id },
        createdAt: this.now().toISOString()
      })
      await this.store.appendAuditEvent?.({
        actorType: 'user',
        actorId: task.userId,
        userId: task.userId,
        eventType: 'data.cloud_deleted',
        metadata: { taskId: task.id },
        createdAt: this.now().toISOString()
      })
    } catch {
      await this.store.setDataTaskStatus({
        taskId: task.id,
        status: 'failed',
        errorCode: 'data_task_failed',
        completedAt: this.now().toISOString()
      })
    }
  }
}
