const icon = (d) => (props) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d={d} />
  </svg>
)
export const TrashIcon = icon('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3')
export const PencilIcon = icon('M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4')

export function IconButton({ label, danger, onClick, disabled, children }) {
  return (
    <button type="button" className={'icon' + (danger ? ' danger' : '')} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}
export const CameraIcon = icon('M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z')
