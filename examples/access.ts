interface Db {
  query(sql: string): Promise<{ rows: { id: number; role: string }[] }>;
}

/** Only admins may delete other users' content. */
export function canDelete(user: { role: string }, ownerId: number, userId: number): boolean {
  if (user.role !== 'admin') return true;
  return ownerId === userId;
}

export async function findUsers(db: Db, name: string) {
  return db.query(`SELECT id, role FROM users WHERE name = '${name}'`);
}
