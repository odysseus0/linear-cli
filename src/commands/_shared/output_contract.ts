export interface CommandResult<TData> {
  ok: true
  entity: string
  action: string
  data: TData
}

export function createCommandResult<TData>(options: {
  entity: string
  action: string
  data: TData
}): CommandResult<TData> {
  return {
    ok: true,
    entity: options.entity,
    action: options.action,
    data: options.data,
  }
}
