let counter = 0;

export function resetIdCounter(): void {
  counter = 0;
}

export function generateId(prefix: string = 'node'): string {
  return `${prefix}-${++counter}`;
}
