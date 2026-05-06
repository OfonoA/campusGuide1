import React, { useEffect, useMemo, useState } from 'react'
import { adminAPI } from '../../services/api'
import { User } from '../../types'
import AdminShell from '../../components/admin/AdminShell'
import FeedbackToastStack from '../../components/feedback/FeedbackToastStack'
import { useFeedbackToasts } from '../../hooks/useFeedbackToasts'
import { ChevronDown, Eye, EyeOff, Plus, Trash2, Pencil, AlertTriangle, X } from 'lucide-react'
import { getErrorDetail } from '../../utils/errors'

const panelClass = 'overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/88 shadow-[0_22px_54px_rgba(15,23,42,0.08)]'
const modalCardClass = 'w-full max-w-md overflow-hidden rounded-[1.5rem] border border-white/70 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)]'

const AdminUsersPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<User['role']>('student')
  const [isLoading, setIsLoading] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [roleFilter, setRoleFilter] = useState<'all' | User['role']>('all')
  const [userToEdit, setUserToEdit] = useState<User | null>(null)
  const [editRole, setEditRole] = useState<User['role']>('student')
  const [isUpdatingRole, setIsUpdatingRole] = useState(false)
  const [editError, setEditError] = useState('')
  const [userToDelete, setUserToDelete] = useState<User | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const pageSize = 4
  const { toasts, dismissToast, showError, showInfo, showSuccess } = useFeedbackToasts()

  useEffect(() => {
    void loadUsers()
  }, [])

  const loadUsers = async () => {
    try {
      const data = await adminAPI.listUsers()
      setUsers(data)
    } catch (error) {
      console.error('Error loading users:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!username.trim() || !password.trim()) {
      showInfo({
        title: 'Missing details',
        message: 'Enter both username and password before creating a user.',
      })
      return
    }
    try {
      await adminAPI.createUser(username.trim(), password.trim(), role)
      const createdUsername = username.trim()
      const createdRole = role
      setUsername('')
      setPassword('')
      setRole('student')
      await loadUsers()
      showSuccess({
        title: 'User created',
        message: `${createdUsername} was created as ${createdRole.replace('_', ' ')}.`,
      })
    } catch (error) {
      console.error('Error creating user:', error)
      showError({
        title: 'User creation failed',
        message: getErrorDetail(error, 'The user account could not be created.'),
      })
    }
  }

  const handleDeleteUser = async () => {
    if (!userToDelete || !deletePassword.trim()) {
      setDeleteError('Enter your password to confirm deletion')
      return
    }

    setIsDeleting(true)
    setDeleteError('')
    try {
      const deletedUsername = userToDelete.username
      await adminAPI.deleteUser(userToDelete.id, deletePassword)
      setUserToDelete(null)
      setDeletePassword('')
      await loadUsers()
      showSuccess({
        title: 'User deleted',
        message: `${deletedUsername} was removed from the system.`,
      })
    } catch (error: any) {
      const detail = getErrorDetail(error, 'Failed to delete user')
      setDeleteError(detail)
      showError({
        title: 'Deletion failed',
        message: detail,
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleUpdateRole = async () => {
    if (!userToEdit) return

    setIsUpdatingRole(true)
    setEditError('')
    try {
      const updatedUsername = userToEdit.username
      await adminAPI.updateUserRole(userToEdit.id, editRole)
      setUserToEdit(null)
      await loadUsers()
      showSuccess({
        title: 'Role updated',
        message: `${updatedUsername} is now ${editRole.replace('_', ' ')}.`,
      })
    } catch (error: any) {
      const detail = getErrorDetail(error, 'Failed to update role')
      setEditError(detail)
      showError({
        title: 'Role update failed',
        message: detail,
      })
    } finally {
      setIsUpdatingRole(false)
    }
  }

  const filteredUsers = useMemo(() => {
    if (roleFilter === 'all') return users
    return users.filter((user) => user.role === roleFilter)
  }, [roleFilter, users])

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize))

  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredUsers.slice(start, start + pageSize)
  }, [currentPage, filteredUsers])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  useEffect(() => {
    setCurrentPage(1)
  }, [roleFilter])

  const roleTone = (value: User['role']) => {
    if (value === 'admin') return 'bg-[#ddd8ff] text-primary-700'
    if (value === 'ar_staff') return 'bg-[#e6bf30] text-[#5c4900]'
    return 'bg-accent-400 text-accent-900'
  }

  return (
    <AdminShell
      title="User Management"
      subtitle="Manage institutional access, roles, and administrative permissions for the MUST portal."
      headerAction={
        <button className="inline-flex items-center gap-3 rounded-xl bg-primary-700 px-5 py-3 text-base font-semibold text-white shadow-[0_16px_24px_rgba(51,51,153,0.18)] transition hover:bg-primary-800">
          <Plus className="h-5 w-5" />
          <span>Create User</span>
        </button>
      }
    >
      <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={panelClass}>
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                User Directory
              </p>
              <p className="mt-2 text-sm text-slate-500">Review active accounts and control who can access student, staff, and admin experiences.</p>
            </div>
            <div className="inline-flex items-center gap-2 text-sm text-slate-600">
              <span>Filter by Role</span>
              <ChevronDown className="h-4 w-4" />
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as 'all' | User['role'])}
                className="bg-transparent text-sm font-medium text-slate-700 outline-none"
              >
                <option value="all">All</option>
                <option value="student">Student</option>
                <option value="ar_staff">AR Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <div className="hidden grid-cols-[1.6fr_0.8fr_0.75fr_0.45fr] gap-5 bg-slate-100 px-6 py-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 lg:grid">
            <div>Username</div>
            <div>Role</div>
            <div>Created</div>
            <div>Actions</div>
          </div>

          {isLoading ? (
            <div className="px-6 py-8 text-sm text-slate-500">Loading users...</div>
          ) : (
            paginatedUsers.map((user, idx) => (
              <React.Fragment key={user.id}>
                <div
                  className={`hidden grid-cols-[1.6fr_0.8fr_0.75fr_0.45fr] gap-5 border-b border-slate-100 px-6 py-6 lg:grid ${
                    idx % 2 === 1 ? 'bg-[#fafafe]' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold ${
                      user.role === 'admin' ? 'bg-[#ddd8ff] text-primary-700' :
                      user.role === 'ar_staff' ? 'bg-[#ffd88b] text-[#8c6500]' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {user.username.slice(0, 2).toUpperCase()}
                    </div>
                    <p className="text-[1.2rem] font-semibold text-slate-900">{user.username}</p>
                  </div>

                  <div>
                    <span className={`inline-flex rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${roleTone(user.role)}`}>
                      {user.role.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="text-sm text-slate-700">
                    {new Date(2023, (user.id % 12), Math.max(1, user.id % 28)).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>

                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => {
                        setUserToEdit(user)
                        setEditRole(user.role)
                        setEditError('')
                      }}
                      className="text-primary-700"
                    >
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => {
                        setUserToDelete(user)
                        setDeletePassword('')
                        setDeleteError('')
                      }}
                      className="text-red-600"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className={`border-b border-slate-100 px-5 py-5 lg:hidden ${idx % 2 === 1 ? 'bg-[#fafafe]' : 'bg-white'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-4">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold ${
                        user.role === 'admin' ? 'bg-[#ddd8ff] text-primary-700' :
                        user.role === 'ar_staff' ? 'bg-[#ffd88b] text-[#8c6500]' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {user.username.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-base font-semibold text-slate-900">{user.username}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {new Date(2023, (user.id % 12), Math.max(1, user.id % 28)).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>
                    <span className={`inline-flex rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${roleTone(user.role)}`}>
                      {user.role.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center gap-4">
                    <button
                      onClick={() => {
                        setUserToEdit(user)
                        setEditRole(user.role)
                        setEditError('')
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-primary-700"
                    >
                      <Pencil className="h-4 w-4" />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => {
                        setUserToDelete(user)
                        setDeletePassword('')
                        setDeleteError('')
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </React.Fragment>
            ))
          )}

          <div className="flex flex-col gap-3 px-5 py-5 text-base text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>
              Showing {paginatedUsers.length} of {filteredUsers.length.toLocaleString()} users
            </p>
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                className="disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                className="disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <div className="space-y-6">
          <section className={panelClass}>
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-[1.8rem] font-semibold text-slate-950">Create New User</h2>
              <p className="mt-2 text-base text-slate-600">
                Assign university credentials and system scope.
              </p>
            </div>

            <div className="space-y-5 px-5 py-6 sm:px-6">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. j.doe@must.ac.ug"
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-[#f5f6fb] px-4 py-3 text-base outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Password
                </label>
                <div className="relative mt-3">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-[#f5f6fb] px-4 py-3 pr-12 text-base outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Role Assignment
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as User['role'])}
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-[#f5f6fb] px-4 py-3 text-base outline-none focus:ring-4 focus:ring-primary-100"
                >
                  <option value="student">Student</option>
                  <option value="ar_staff">AR Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <button
                onClick={handleCreate}
                className="flex w-full items-center justify-center gap-3 rounded-[1.2rem] bg-primary-700 px-5 py-3.5 text-base font-semibold text-white transition hover:bg-primary-800"
              >
                <Plus className="h-5 w-5" />
                <span>Create User</span>
              </button>
            </div>
          </section>

        </div>
      </div>

      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
          <div className={`min-h-[48vh] sm:min-h-0 ${modalCardClass}`}>
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-1 h-5 w-5 text-red-600" />
                <div>
                  <h3 className="text-xl font-semibold text-slate-950">Confirm User Deletion</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    This action will permanently remove <span className="font-semibold text-slate-700">{userToDelete.username}</span> if the account has no linked records.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUserToDelete(null)
                  setDeletePassword('')
                  setDeleteError('')
                }}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close delete confirmation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-6">
              <p className="text-sm text-slate-600">
                Enter your admin password to confirm this action.
              </p>

              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Admin password"
                className="w-full rounded-2xl border border-slate-200 bg-[#f5f6fb] px-4 py-3 text-base outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100"
              />

              {deleteError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {deleteError}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setUserToDelete(null)
                    setDeletePassword('')
                    setDeleteError('')
                  }}
                  className="rounded-[1rem] border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteUser()}
                  disabled={isDeleting}
                  className="rounded-[1rem] bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting...' : 'Delete User'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {userToEdit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
          <div className={`min-h-[44vh] sm:min-h-0 ${modalCardClass}`}>
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-xl font-semibold text-slate-950">Edit User Role</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Update the role for <span className="font-semibold text-slate-700">{userToEdit.username}</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUserToEdit(null)
                  setEditError('')
                }}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close role editor"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-6">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Role Assignment
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as User['role'])}
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-[#f5f6fb] px-4 py-3 text-base outline-none focus:ring-4 focus:ring-primary-100"
                >
                  <option value="student">Student</option>
                  <option value="ar_staff">AR Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              {editError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {editError}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setUserToEdit(null)
                    setEditError('')
                  }}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleUpdateRole()}
                  disabled={isUpdatingRole}
                  className="rounded-xl bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-800 disabled:opacity-50"
                >
                  {isUpdatingRole ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  )
}

export default AdminUsersPage
