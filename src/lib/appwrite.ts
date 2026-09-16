import { Client, Account } from 'appwrite'

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT ?? ''
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID ?? ''

export const appwriteConfigured = Boolean(endpoint && projectId)

export const appwrite = new Client()
  .setEndpoint(endpoint || 'https://cloud.appwrite.io/v1')
  .setProject(projectId || 'not-configured')

export const account = new Account(appwrite)
