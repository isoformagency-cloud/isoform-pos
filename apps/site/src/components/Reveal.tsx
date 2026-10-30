import type { ComponentProps } from 'react'
import AnimatedContent from './reactbits/AnimatedContent'

/** The site's one scroll reveal, so motion stays consistent across pages. */
export function Reveal(props: ComponentProps<typeof AnimatedContent>) {
  return <AnimatedContent distance={28} duration={0.7} threshold={0.12} {...props} />
}
