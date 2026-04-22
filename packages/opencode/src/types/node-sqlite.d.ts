declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readonly?: boolean; create?: boolean })
    close(): void
    exec(sql: string): void
    prepare(sql: string): unknown
  }
}
