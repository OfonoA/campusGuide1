import React, { useEffect, useMemo, useState } from 'react'
import { adminAPI } from '../../services/api'
import { User } from '../../types'
import AdminShell from '../../components/admin/AdminShell'
import FeedbackToastStack from '../../components/feedback/FeedbackToastStack'
import { useFeedbackToasts } from '../../hooks/useFeedbackToasts'
import { AlertTriangle, UserPlus, Users, X } from 'lucide-react'
import { getErrorDetail } from '../../utils/errors'

const panelClass = 'overflow-hidden rounded-[8px] border border-[#F0F2F5] bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]'
const modalCardClass = 'w-full max-w-md overflow-hidden rounded-[8px] border border-[#F0F2F5] bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]'

const roleOptions: Array<{ value: 'all' | User['role']; label: string }> = [
  { value: 'all', label: 'All roles' },
  { value: 'student', label: 'Student' },
  { value: 'ar_staff', label: 'AR Staff' },
  { value: 'admin', label: 'Admin' },
]
const assignmentAreaOptions = [
  { value: 'admissions_records_alumni_engagement', label: 'Admissions, Records & Alumni Engagement' },
  { value: 'documents', label: 'Documents' },
  { value: 'results', label: 'Results' },
  { value: 'teaching_and_learning', label: 'Teaching and Learning' },
  { value: 'general', label: 'General' },
] as const

const roleLabel = (role: User['role']) => {
  if (role === 'ar_staff') return 'AR Staff'
  if (role === 'admin') return 'Admin'
  return 'Student'
}

const roleBadgeClass = (role: User['role']) => {
  if (role === 'admin') return 'bg-[#1E6B3B] text-white'
  if (role === 'ar_staff') return 'bg-[#F5EDD6] text-[#B8860B]'
  return 'bg-[#E0F0EA] text-[#1E6B3B]'
}

const getCreatedDate = (user: User) =>
  user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'Unknown'

const getLastActiveMeta = (user: User) => {
  if (!user.last_active_at) {
    return { dotClass: 'bg-[#999999]', label: 'No activity yet' }
  }

  const now = Date.now()
  const lastActive = new Date(user.last_active_at).getTime()
  const diffDays = Math.floor((now - lastActive) / (1000 * 60 * 60 * 24))

  if (diffDays <= 1) {
    return { dotClass: 'bg-[#1E6B3B]', label: 'Active today' }
  }

  if (diffDays <= 7) {
    return { dotClass: 'bg-[#1E6B3B]', label: 'Active this week' }
  }

  if (diffDays > 90) {
    return { dotClass: 'bg-[#999999]', label: '90+ days' }
  }

  if (diffDays > 30) {
    return { dotClass: 'bg-[#B8860B]', label: '30+ days' }
  }

  return {
    dotClass: 'bg-[#1E6B3B]',
    label: new Date(user.last_active_at).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    }),
  }
}

const generateTemporaryPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

const normalizeAreas = (areas: string[]) => Array.from(new Set(areas.filter(Boolean)))

const AdminUsersPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [department, setDepartment] = useState('')
  const [role, setRole] = useState<User['role']>('student')
  const [assignmentAreas, setAssignmentAreas] = useState<string[]>(['general'])
  const [maxConcurrentLoad, setMaxConcurrentLoad] = useState('10')
  const [isAvailable, setIsAvailable] = useState(true)
  const [priorityWeight, setPriorityWeight] = useState('1')
  const [isLoading, setIsLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [roleFilter, setRoleFilter] = useState<'all' | User['role']>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [userToEdit, setUserToEdit] = useState<User | null>(null)
  const [editRole, setEditRole] = useState<User['role']>('student')
  const [editAssignmentAreas, setEditAssignmentAreas] = useState<string[]>(['general'])
  const [editMaxConcurrentLoad, setEditMaxConcurrentLoad] = useState('10')
  const [editIsAvailable, setEditIsAvailable] = useState(true)
  const [editPriorityWeight, setEditPriorityWeight] = useState('1')
  const [isUpdatingRole, setIsUpdatingRole] = useState(false)
  const [editError, setEditError] = useState('')
  const [userToDelete, setUserToDelete] = useState<User | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const pageSize = 6
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

  const handleGeneratePassword = () => {
    setPassword(generateTemporaryPassword())
  }

  const handleCreate = async () => {
    if (!username.trim() || !password.trim()) {
      showInfo({
        title: 'Missing details',
        message: 'Enter a username and generate a temporary password before creating a user.',
      })
      return
    }
    try {
      await adminAPI.createUser(username.trim(), password.trim(), role, {
        assignment_areas: role === 'ar_staff' ? normalizeAreas(assignmentAreas) : [],
        max_concurrent_load:
          role === 'ar_staff' && maxConcurrentLoad.trim()
            ? Number(maxConcurrentLoad)
            : null,
        is_available: role === 'ar_staff' ? isAvailable : true,
        priority_weight: role === 'ar_staff' && priorityWeight.trim() ? Number(priorityWeight) : 1,
      })
      const createdUsername = username.trim()
      const createdRole = role
      setUsername('')
      setPassword('')
      setEmail('')
      setDepartment('')
      setRole('student')
      setAssignmentAreas(['general'])
      setMaxConcurrentLoad('10')
      setIsAvailable(true)
      setPriorityWeight('1')
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
      await adminAPI.updateUserRole(
        userToEdit.id,
        editRole,
        editRole === 'ar_staff'
          ? {
              assignment_areas: normalizeAreas(editAssignmentAreas),
              max_concurrent_load: editMaxConcurrentLoad.trim() ? Number(editMaxConcurrentLoad) : null,
              is_available: editIsAvailable,
              priority_weight: editPriorityWeight.trim() ? Number(editPriorityWeight) : 1,
            }
          : undefined,
      )
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

  const toggleArea = (
    nextArea: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    setter((prev) => {
      if (prev.includes(nextArea)) {
        const next = prev.filter((area) => area !== nextArea)
        return next.length > 0 ? next : ['general']
      }
      return normalizeAreas([...prev, nextArea])
    })
  }

  const filteredUsers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()

    return users.filter((user) => {
      const matchesRole = roleFilter === 'all' || user.role === roleFilter
      const matchesQuery =
        !query ||
        user.username.toLowerCase().includes(query) ||
        roleLabel(user.role).toLowerCase().includes(query) ||
        (user.email || '').toLowerCase().includes(query)
      return matchesRole && matchesQuery
    })
  }, [roleFilter, searchTerm, users])

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
  }, [roleFilter, searchTerm])

  const stats = useMemo(() => {
    const activeUsers = users.length
    const staff = users.filter((user) => user.role === 'ar_staff').length
    const students = users.filter((user) => user.role === 'student').length
    return { activeUsers, staff, students }
  }, [users])

  return (
    <AdminShell
      title="User Management"
      subtitle="Manage institutional access, user roles, and account administration for ArASSIST."
      titleIcon={<Users />}
      fullWidth
    >
      <style>{`
        .user-management-screen {
          --admin-primary: #1E6B3B;
          --admin-accent: #B8860B;
          --card-bg: #FFFFFF;
          --page-bg: #F0F2F5;
          --text-dark: #333333;
          --text-light: #FFFFFF;
          --success-tint: #E0F0EA;
          --warning-tint: #F5EDD6;
          --light-grey: #F0F2F5;
          --inactive-dot: #999999;
        }

        .user-stats-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .user-stat-card {
          background: var(--card-bg);
          border-top: 4px solid var(--admin-primary);
          border-radius: 8px;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
          padding: 1rem;
          text-align: center;
        }

        .user-stat-value {
          color: var(--admin-accent);
          font-size: 2rem;
          font-weight: 700;
          line-height: 1.1;
        }

        .user-stat-label {
          color: var(--text-dark);
          font-size: 0.875rem;
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-top: 0.55rem;
          text-transform: uppercase;
        }

        .user-filter-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }

        .user-search-input,
        .user-form-input,
        .user-form-select,
        .user-filter-select {
          border: 1px solid #DDD;
          border-radius: 6px;
          color: var(--text-dark);
          background: #FFFFFF;
          padding: 8px 12px;
        }

        .user-search-input {
          width: 300px;
          max-width: 100%;
        }

        .user-filter-select,
        .user-form-select {
          border-color: var(--admin-accent);
        }

        .user-search-input:focus,
        .user-form-input:focus,
        .user-form-select:focus,
        .user-filter-select:focus {
          border-color: var(--admin-primary);
          outline: none;
        }

        .user-directory-table {
          width: 100%;
          border-collapse: collapse;
        }

        .user-directory-table th {
          background: var(--page-bg);
          color: var(--admin-primary);
          font-weight: 700;
          padding: 12px;
          text-align: left;
        }

        .user-directory-table td {
          border-bottom: 1px solid #EEE;
          padding: 12px;
          vertical-align: middle;
        }

        .user-directory-table tbody tr:hover {
          background: #FAFAFA;
        }

        .user-role-badge {
          border-radius: 20px;
          display: inline-block;
          font-size: 0.75rem;
          font-weight: 600;
          padding: 4px 10px;
        }

        .user-status-chip {
          align-items: center;
          display: inline-flex;
          gap: 0.5rem;
        }

        .user-status-dot {
          border-radius: 999px;
          display: inline-block;
          height: 8px;
          width: 8px;
        }

        .user-action-button {
          background: none;
          border: none;
          color: #666666;
          cursor: pointer;
          font-size: 1rem;
          margin: 0 4px;
          padding: 0;
          transition: color 160ms ease;
        }

        .user-action-button:hover {
          color: var(--admin-accent);
        }

        .user-action-button:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }

        .create-user-card {
          background: var(--card-bg);
          border-top: 4px solid var(--admin-primary);
          border-radius: 8px;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
          margin-top: 1.5rem;
          padding: 1.25rem;
        }

        .create-user-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: 1fr 1fr;
        }

        .create-user-span {
          grid-column: 1 / -1;
        }

        .generate-password-button {
          background: transparent;
          border: 1px solid var(--admin-accent);
          border-radius: 6px;
          color: var(--admin-accent);
          cursor: pointer;
          margin-right: 1rem;
          padding: 8px 16px;
        }

        .generate-password-button:hover {
          background: var(--admin-accent);
          color: var(--text-dark);
        }

        .temporary-password-chip {
          background: #F5F5F5;
          border: 1px solid #DDD;
          border-radius: 6px;
          display: inline-block;
          font-family: monospace;
          padding: 8px;
        }

        .create-user-button {
          background: var(--admin-accent);
          border: none;
          border-radius: 6px;
          color: var(--text-dark);
          cursor: pointer;
          font-weight: 600;
          margin-top: 1rem;
          padding: 10px 20px;
        }

        .create-user-button:hover {
          background: var(--admin-primary);
          color: var(--text-light);
        }

        @media (max-width: 767px) {
          .user-stats-grid,
          .create-user-grid {
            grid-template-columns: 1fr;
          }

          .user-filter-row {
            align-items: stretch;
            flex-direction: column;
          }
        }
      `}</style>

      <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="user-management-screen space-y-6">
        <h2 className="section-heading">
          Account Overview
          <span className="section-subtitle">Current user distribution across students, staff, and administrators.</span>
        </h2>
        <section className="user-stats-grid">
          <article className="user-stat-card">
            <div className="user-stat-value">{stats.activeUsers}</div>
            <div className="user-stat-label">Active Users</div>
          </article>
          <article className="user-stat-card">
            <div className="user-stat-value">{stats.staff}</div>
            <div className="user-stat-label">Staff</div>
          </article>
          <article className="user-stat-card">
            <div className="user-stat-value">{stats.students}</div>
            <div className="user-stat-label">Students</div>
          </article>
        </section>

        <section className={panelClass}>
          <div className="space-y-5 px-5 py-5 sm:px-6">
            <div>
              <h2 className="card-title">
                <Users className="h-4 w-4" />
                User Directory
              </h2>
              <p className="section-subtitle">Search, filter, and manage account access across the administration workspace.</p>
            </div>
            <div className="user-filter-row">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by username or role..."
                className="user-search-input"
              />

              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as 'all' | User['role'])}
                className="user-filter-select"
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="user-directory-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Created</th>
                    <th>Last Active</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="text-sm text-[#333333]">
                        Loading users...
                      </td>
                    </tr>
                  ) : paginatedUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-sm text-[#333333]">
                        No users match the current search or filter.
                      </td>
                    </tr>
                  ) : (
                    paginatedUsers.map((user) => {
                      const lastActive = getLastActiveMeta(user)
                      return (
                        <tr key={user.id}>
                          <td className="font-medium text-[#333333]">{user.username}</td>
                          <td>
                            <span className={`user-role-badge ${roleBadgeClass(user.role)}`}>
                              {roleLabel(user.role)}
                            </span>
                          </td>
                          <td className="text-sm text-[#333333]">{getCreatedDate(user)}</td>
                          <td>
                            <span className="user-status-chip text-sm text-[#333333]">
                              <span className={`user-status-dot ${lastActive.dotClass}`} />
                              <span>{lastActive.label}</span>
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              title="Edit User"
                              className="user-action-button"
                              onClick={() => {
                                setUserToEdit(user)
                                setEditRole(user.role)
                                setEditAssignmentAreas(user.assignment_areas && user.assignment_areas.length > 0 ? user.assignment_areas : ['general'])
                                setEditMaxConcurrentLoad(
                                  user.max_concurrent_load != null ? String(user.max_concurrent_load) : '',
                                )
                                setEditIsAvailable(user.is_available ?? true)
                                setEditPriorityWeight(
                                  user.priority_weight != null ? String(user.priority_weight) : '1',
                                )
                                setEditError('')
                              }}
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              title="Reset Password"
                              className="user-action-button"
                              onClick={() => {
                                showInfo({
                                  title: 'Password reset not available',
                                  message: `Password reset for ${user.username} is not wired to the backend yet.`,
                                })
                              }}
                            >
                              🔄
                            </button>
                            <button
                              type="button"
                              title="Disable User"
                              className="user-action-button"
                              onClick={() => {
                                showInfo({
                                  title: 'Disable action not available',
                                  message: `Disable user for ${user.username} is not available in this build yet.`,
                                })
                              }}
                            >
                              ⛔
                            </button>
                            <button
                              type="button"
                              title="Delete User"
                              className="user-action-button"
                              onClick={() => {
                                setUserToDelete(user)
                                setDeletePassword('')
                                setDeleteError('')
                              }}
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 text-sm text-[#333333] sm:flex-row sm:items-center sm:justify-between">
              <p>
                Showing {paginatedUsers.length} of {filteredUsers.length.toLocaleString()} users
              </p>
              <div className="flex items-center gap-6">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                  className="font-medium text-[#1E6B3B] disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                  className="font-medium text-[#1E6B3B] disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="create-user-card">
          <h2 className="card-title">
            <UserPlus className="h-4 w-4" />
            Create New User
          </h2>
          <p className="section-subtitle">Provision student, staff, and admin accounts with the existing role rules.</p>

          <div className="create-user-grid">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#333333]">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="user-form-input w-full"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#333333]">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="user-form-input w-full"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#333333]">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as User['role'])}
                className="user-form-select w-full"
              >
                <option value="student">Student</option>
                <option value="ar_staff">AR Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#333333]">Department</label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g., Registrar, IT, Finance"
                className="user-form-input w-full"
              />
            </div>

            <div className="create-user-span">
              <label className="mb-3 block text-sm font-medium text-[#333333]">Generate Password</label>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleGeneratePassword}
                  className="generate-password-button"
                >
                  Generate Password
                </button>
                {password ? <span className="temporary-password-chip">{password}</span> : null}
              </div>
            </div>

            {role === 'ar_staff' ? (
              <>
                <div className="create-user-span">
                  <label className="mb-2 block text-sm font-medium text-[#333333]">Assignment Areas</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {assignmentAreaOptions.map((option) => (
                      <label key={option.value} className="flex items-center gap-2 text-sm text-[#333333]">
                        <input
                          type="checkbox"
                          checked={assignmentAreas.includes(option.value)}
                          onChange={() => toggleArea(option.value, setAssignmentAreas)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#333333]">Max Concurrent Load</label>
                  <input
                    type="number"
                    min="1"
                    value={maxConcurrentLoad}
                    onChange={(e) => setMaxConcurrentLoad(e.target.value)}
                    className="user-form-input w-full"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#333333]">Priority Weight</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={priorityWeight}
                    onChange={(e) => setPriorityWeight(e.target.value)}
                    className="user-form-input w-full"
                  />
                </div>

                <div className="create-user-span">
                  <label className="flex items-center gap-2 text-sm font-medium text-[#333333]">
                    <input
                      type="checkbox"
                      checked={isAvailable}
                      onChange={(e) => setIsAvailable(e.target.checked)}
                    />
                    <span>Officer is available for assignment</span>
                  </label>
                </div>
              </>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void handleCreate()}
            className="create-user-button"
          >
            Create User
          </button>
        </section>
      </div>

      {userToDelete ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#333333]/45 px-0 py-0 sm:items-center sm:px-4 sm:py-6">
          <div className={`min-h-[48vh] sm:min-h-0 ${modalCardClass}`}>
            <div className="flex items-start justify-between border-b border-[#F0F2F5] px-6 py-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-1 h-5 w-5 text-[#B8860B]" />
                <div>
                  <h3 className="text-xl font-semibold text-[#333333]">Confirm User Deletion</h3>
                  <p className="mt-1 text-sm text-[#333333]">
                    This action will permanently remove <span className="font-semibold">{userToDelete.username}</span> if the account has no linked records.
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
                className="rounded-full p-2 text-[#333333] transition hover:bg-[#F0F2F5]"
                aria-label="Close delete confirmation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-6">
              <p className="text-sm text-[#333333]">Enter your admin password to confirm this action.</p>

              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Admin password"
                className="user-form-input w-full"
              />

              {deleteError ? (
                <div className="rounded-[8px] border border-[#B8860B] bg-[#F5EDD6] px-4 py-3 text-sm text-[#333333]">
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
                  className="rounded-[6px] border border-[#DDD] px-4 py-2.5 text-sm font-medium text-[#333333] transition hover:bg-[#F0F2F5]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteUser()}
                  disabled={isDeleting}
                  className="rounded-[6px] bg-[#B8860B] px-4 py-2.5 text-sm font-semibold text-[#333333] transition hover:bg-[#1E6B3B] hover:text-white disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting...' : 'Delete User'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {userToEdit ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#333333]/45 px-0 py-0 sm:items-center sm:px-4 sm:py-6">
          <div className={`min-h-[44vh] sm:min-h-0 ${modalCardClass}`}>
            <div className="flex items-start justify-between border-b border-[#F0F2F5] px-6 py-5">
              <div>
                <h3 className="text-xl font-semibold text-[#333333]">Edit User Role</h3>
                <p className="mt-1 text-sm text-[#333333]">
                  Update the role for <span className="font-semibold">{userToEdit.username}</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUserToEdit(null)
                  setEditError('')
                }}
                className="rounded-full p-2 text-[#333333] transition hover:bg-[#F0F2F5]"
                aria-label="Close role editor"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#333333]">Role Assignment</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as User['role'])}
                  className="user-form-select w-full"
                >
                  <option value="student">Student</option>
                  <option value="ar_staff">AR Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              {editRole === 'ar_staff' ? (
                <>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#333333]">Assignment Areas</label>
                    <div className="grid gap-2">
                      {assignmentAreaOptions.map((option) => (
                        <label key={option.value} className="flex items-center gap-2 text-sm text-[#333333]">
                          <input
                            type="checkbox"
                            checked={editAssignmentAreas.includes(option.value)}
                            onChange={() => toggleArea(option.value, setEditAssignmentAreas)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#333333]">Max Concurrent Load</label>
                    <input
                      type="number"
                      min="1"
                      value={editMaxConcurrentLoad}
                      onChange={(e) => setEditMaxConcurrentLoad(e.target.value)}
                      className="user-form-input w-full"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#333333]">Priority Weight</label>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={editPriorityWeight}
                      onChange={(e) => setEditPriorityWeight(e.target.value)}
                      className="user-form-input w-full"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-sm font-medium text-[#333333]">
                    <input
                      type="checkbox"
                      checked={editIsAvailable}
                      onChange={(e) => setEditIsAvailable(e.target.checked)}
                    />
                    <span>Officer is available for assignment</span>
                  </label>
                </>
              ) : null}

              {editError ? (
                <div className="rounded-[8px] border border-[#B8860B] bg-[#F5EDD6] px-4 py-3 text-sm text-[#333333]">
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
                  className="rounded-[6px] border border-[#DDD] px-4 py-2.5 text-sm font-medium text-[#333333] transition hover:bg-[#F0F2F5]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleUpdateRole()}
                  disabled={isUpdatingRole}
                  className="rounded-[6px] bg-[#B8860B] px-4 py-2.5 text-sm font-semibold text-[#333333] transition hover:bg-[#1E6B3B] hover:text-white disabled:opacity-50"
                >
                  {isUpdatingRole ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  )
}

export default AdminUsersPage
