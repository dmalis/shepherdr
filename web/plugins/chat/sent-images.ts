// #56: a picture you sent shows as itself under your message, from the agent's log when its CLI didn't say where the
// file was (service/sent-images.ts). The line that stays is one the chat can't show yet, and says why: it waits in
// the CLI's queue, and shows once the agent takes it.

/** "1 image", "3 images · shows once read" */
export const imagesLine = (n: number, waiting?: boolean) => `${n === 1 ? '1 image' : `${n} images`}${waiting ? ' · shows once read' : ''}`

/** a sent picture that can't be read now (its machine is away, or its log moved on): never a broken picture to tap */
export const lostLine = '1 image · not available'
