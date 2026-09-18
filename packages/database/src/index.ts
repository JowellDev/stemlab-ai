export { createDatabase, getDatabase, type DatabaseOptions, type PrismaClient } from './client.js'

/**
 * Types et enumerations du schema.
 *
 * Prisma 7 suffixe les types de modele (`TrackModel`) ; on les re-expose sous le nom
 * du modele, pour que les applications ecrivent `Track` et n'aient jamais a
 * connaitre le chemin de sortie du generateur.
 */
export type {
  AccountModel as Account,
  AnalysisModel as Analysis,
  JobModel as Job,
  SessionModel as Session,
  StemModel as Stem,
  TrackModel as Track,
  UserModel as User,
  VerificationModel as Verification,
} from './generated/prisma/models.js'

export {
  JobStatus,
  Plan,
  SeparationModel,
  StemType,
  TrackStatus,
} from './generated/prisma/enums.js'
