# TaskFlow Demo

Dữ liệu và hình minh họa giả lập. Không phải bằng chứng từ ứng dụng thật.

**Application:** https://example.com

**Coverage:** 2 verified / 6 discovered features (not total app coverage).

## Features

| Area | Feature | Status |
| --- | --- | --- |
| Projects | [Tạo dự án](features/projects.create.md) | verified |
| Projects | [Mời thành viên](features/projects.invite.md) | partial |
| Tasks | [Phân công công việc](features/tasks.assign.md) | verified |
| Tasks | [Lọc công việc](features/tasks.filter.md) | partial |
| Reports | [Xuất báo cáo](features/reports.export.md) | discovered |
| Settings | [Quản lý vai trò](features/settings.roles.md) | blocked |

## Journeys

- **Bắt đầu một dự án**: projects.create → projects.invite → tasks.assign
- **Theo dõi và báo cáo**: tasks.filter → reports.export
