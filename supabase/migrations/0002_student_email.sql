-- Email học viên (đăng ký + đăng nhập bằng Google). Chạy trong Supabase SQL Editor TRƯỚC khi deploy bản code mới.
-- An toàn chạy lại nhiều lần.
alter table students add column if not exists email text;
-- true = email đã được Google xác nhận (đăng ký/liên kết qua Google); false = học viên tự gõ tay
alter table students add column if not exists email_verified boolean not null default false;

-- Mỗi email chỉ thuộc về MỘT học viên (không phân biệt hoa/thường). Học viên cũ chưa có email (null) không bị ràng buộc.
create unique index if not exists students_email_uniq on students (lower(email)) where email is not null;
