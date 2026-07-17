import { describe, expect, it } from 'vitest'
import {
  DataControlService,
  type DataControlStore,
  type DataTask
} from '../../../../drive/src/server/data-control'

function createStore(): DataControlStore & {
  tasks: Map<string, DataTask>
  audits: string[]
  controls: string[]
} {
  const tasks = new Map<string, DataTask>()
  const audits: string[] = []
  const controls: string[] = []
  return {
    tasks,
    audits,
    controls,
    async createDataTask(input) {
      const task: DataTask = {
        id: `${input.type}-1`,
        userId: input.userId,
        type: input.type,
        status: 'pending',
        result: null,
        errorCode: null,
        requestedAt: input.requestedAt,
        completedAt: null
      }
      tasks.set(task.id, task)
      return task
    },
    async getDataTask(userId, taskId) {
      const task = tasks.get(taskId)
      return task?.userId === userId ? task : undefined
    },
    async setDataTaskStatus(input) {
      const task = tasks.get(input.taskId)
      if (!task) throw new Error('missing task')
      tasks.set(input.taskId, {
        ...task,
        status: input.status,
        result: input.result ?? task.result,
        errorCode: input.errorCode ?? task.errorCode,
        completedAt: input.completedAt ?? task.completedAt
      })
    },
    async exportUserData() {
      return { entities: [{ entityType: 'setting', entityKey: 'theme' }] }
    },
    async deleteUserData() {},
    async appendAuditEvent(event) {
      audits.push(event.eventType)
    },
    async appendControlEvent(event) {
      controls.push(event.type)
    }
  }
}

async function waitForCompletion(store: ReturnType<typeof createStore>, id: string) {
  for (let i = 0; i < 10; i++) {
    const task = store.tasks.get(id)
    if (task?.status === 'completed') return task
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('task did not complete')
}

describe('DataControlService', () => {
  it('queues an export and completes with only sync entities', async () => {
    const store = createStore()
    const service = new DataControlService(store, () => new Date('2026-07-13T00:00:00.000Z'))

    const task = await service.request('user-1', 'export')
    expect(task.status).toBe('pending')
    await expect(waitForCompletion(store, task.id)).resolves.toMatchObject({ status: 'completed' })
    expect(store.tasks.get(task.id)?.result).toEqual({
      entities: [{ entityType: 'setting', entityKey: 'theme' }]
    })
    expect(store.audits).toContain('data.export_completed')
  })

  it('queues deletion and records control plus audit events', async () => {
    const store = createStore()
    const service = new DataControlService(store)

    const task = await service.request('user-1', 'delete')
    await expect(waitForCompletion(store, task.id)).resolves.toMatchObject({ status: 'completed' })
    expect(store.controls).toContain('cloud_data_deleted')
    expect(store.audits).toContain('data.cloud_deleted')
  })

  it("does not expose another user's task", async () => {
    const store = createStore()
    const service = new DataControlService(store)
    const task = await service.request('user-1', 'export')

    await expect(service.get('user-2', task.id)).resolves.toBeUndefined()
  })
})
