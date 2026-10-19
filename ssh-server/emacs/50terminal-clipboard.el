;;; 50terminal-clipboard.el --- Copy from terminal Emacs using OSC 52 -*- lexical-binding: t; -*-

;; Install root-owned as /etc/emacs/site-start.d/50terminal-clipboard.el.
;; Uses Emacs's built-in per-terminal backend, leaving GUI frames, normal
;; keybindings, capability discovery and clipboard reads unchanged.
(defgroup depaul-terminal-clipboard nil
  "Clipboard copying from terminal Emacs."
  :group 'terminals)

(defcustom depaul-terminal-clipboard-enabled t
  "Allow terminal Emacs to copy killed/saved text using OSC 52.
The client terminal must permit OSC 52 writes.  This does not enable clipboard
queries.  Set to nil in your init file to opt out."
  :type 'boolean
  :group 'depaul-terminal-clipboard)

(defun depaul-terminal-clipboard-setup ()
  "Enable the built-in clipboard writer for the current text terminal."
  (when (and depaul-terminal-clipboard-enabled
             (not (display-graphic-p))
             (fboundp 'xterm--init-activate-set-selection))
    (xterm--init-activate-set-selection)))

;; Runs after user initialization and normal terminal capability discovery,
;; including when a daemon gains a new terminal frame through emacsclient.
(add-hook 'terminal-init-xterm-hook #'depaul-terminal-clipboard-setup)

(provide 'depaul-terminal-clipboard)
;;; 50terminal-clipboard.el ends here
