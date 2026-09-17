// Cree la base applicative si elle n'existe pas encore.
//
// Les binaires Postgres userspace (zonky) n'embarquent ni `psql` ni `createdb` :
// on passe donc par le protocole, avec le client `pg` deja present pour l'adaptateur
// Prisma. Sans effet si la base existe deja.
import { Client } from 'pg'

const host = process.env.PGHOST ?? '127.0.0.1'
const port = Number(process.env.PGPORT ?? 55432)
const user = process.env.PGUSER ?? 'stemlab'
const password = process.env.PGPASSWORD ?? 'stemlab'
const database = process.argv[2] ?? 'stemlab'

const client = new Client({ host, port, user, password, database: 'postgres' })

try {
  await client.connect()
  const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [database])
  if (rowCount === 0) {
    // Pas de parametre liable pour un identifiant : on echappe les guillemets nous-memes.
    await client.query(`create database "${database.replaceAll('"', '""')}"`)
    console.log(`[ensure-db] base "${database}" creee`)
  } else {
    console.log(`[ensure-db] base "${database}" deja presente`)
  }
} catch (error) {
  console.error(`[ensure-db] echec : ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {
    /* connexion deja fermee : rien a signaler */
  })
}
