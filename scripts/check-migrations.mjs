#!/usr/bin/env node
/**
 * Signale les migrations qui empechent un retour arriere.
 *
 * Revenir a la version precedente du code est facile ; revenir sur une migration
 * ne l'est pas. Une colonne supprimee emporte ses donnees, et l'ancien code qui
 * revient la cherche en vain. La discipline est celle du `expand / contract` :
 * une version ajoute, une version ulterieure retire — jamais la meme.
 *
 * Ce controle n'interdit rien : il rend visible, au moment de la revue, ce qui
 * rendra le deploiement irreversible.
 *
 * Usage :
 *   node scripts/check-migrations.mjs            # toutes les migrations
 *   node scripts/check-migrations.mjs --since=<nom>
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(import.meta.dirname, '../packages/database/prisma/migrations')

/**
 * Motifs destructifs.
 *
 * `ADD COLUMN ... NOT NULL` sans valeur par defaut merite la meme attention :
 * l'ancien code, qui ignore la colonne, ne peut plus inserer une ligne.
 */
const PATTERNS = [
  { re: /\bDROP\s+TABLE\b/i, label: 'suppression de table' },
  { re: /\bDROP\s+COLUMN\b/i, label: 'suppression de colonne' },
  { re: /\bDROP\s+(?:TYPE|SCHEMA)\b/i, label: 'suppression de type ou de schema' },
  { re: /\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i, label: 'changement de type de colonne' },
  { re: /\bRENAME\s+(?:TO|COLUMN)\b/i, label: 'renommage' },
  {
    re: /\bADD\s+COLUMN\b(?:(?!DEFAULT)[\s\S])*?\bNOT\s+NULL\b(?![\s\S]*?\bDEFAULT\b)/i,
    label: 'colonne obligatoire sans valeur par defaut',
  },
]

const since = process.argv.find((arg) => arg.startsWith('--since='))?.slice(8)

const migrations = readdirSync(DIR)
  .filter((name) => statSync(join(DIR, name)).isDirectory())
  .sort()

const considered = since
  ? migrations.slice(migrations.findIndex((name) => name.includes(since)) + 1)
  : migrations

if (considered.length === 0) {
  console.log('Aucune migration a examiner.')
  process.exit(0)
}

let risky = 0

for (const name of considered) {
  const sql = readFileSync(join(DIR, name, 'migration.sql'), 'utf8')
  // Les commentaires SQL contiennent parfois le mot-cle sans l'instruction.
  const statements = sql.replace(/^\s*--.*$/gm, '')

  const found = PATTERNS.filter(({ re }) => re.test(statements))
  if (found.length === 0) {
    console.log(`  ✓ ${name}`)
    continue
  }

  risky += 1
  console.log(`  ! ${name}`)
  for (const { label } of found) console.log(`      ${label}`)
}

if (risky === 0) {
  console.log(`\n${considered.length} migration(s) : toutes reversibles par simple retour du code.`)
  process.exit(0)
}

const message =
  `${risky} migration(s) sur ${considered.length} rendent le retour arriere destructif. ` +
  'Un retour du code seul ne suffira pas : voir infra/ROLLBACK.md avant de deployer.'

console.log(`\n${message}`)

// Le controle n'echoue pas : une migration destructive est parfois le bon choix.
// Sous integration continue, l'annotation la rend visible dans la revue — un
// message imprime au milieu d'un journal ne l'est pas.
if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Retour arriere::${message}`)
