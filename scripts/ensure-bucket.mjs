// Cree le bucket applicatif sur le stockage S3 de developpement, s'il manque.
// Requiert une requete signee SigV4 : le endpoint local refuse les appels anonymes.
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'

const bucket = process.env.S3_BUCKET ?? 'stemlab'
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:59000',
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'stemlab-dev',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'stemlab-dev-secret',
  },
})

/** HeadBucket renvoie 404/NotFound quand le bucket n'existe pas encore. */
function isMissingBucket(error) {
  return (
    error instanceof S3ServiceException &&
    (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404)
  )
}

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }))
  console.log(`[ensure-bucket] bucket "${bucket}" deja present`)
} catch (error) {
  if (!isMissingBucket(error)) {
    console.error(
      `[ensure-bucket] echec : ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  } else {
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
    console.log(`[ensure-bucket] bucket "${bucket}" cree`)
  }
} finally {
  client.destroy()
}
