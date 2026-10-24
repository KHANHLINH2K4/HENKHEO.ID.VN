import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { policyConfig, checkCustomerChange, overlapsWithBuffer } from "../policy.js";
import { authenticateToken, requireAdminOrStaff, requireCustomer } from "../middleware/authMiddleware.js";
import { writeAudit } from "../utils_audit.js";
import { getEffectiveSchedules } from "../scheduleResolver.js";
import { validateBookingWindow } from "./appointments.js";
import { addNotification, notifyAdmins as notifyAdminsShared } from "../notify.js";

const router = Router();

function parseTime(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const h = value.getUTCHours();
    const m = value.getUTCMinutes();
    return { h, m, text: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
  }
  const text = String(value).slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const [h, m] = text.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return { h, m, text };
}

const minutes = (value) => {
  const t = parseTime(value);
  return t ? t.h * 60 + t.m : 0;
};

const timeText = (value) => parseTime(value)?.text || "";

async function getCustomer(pool, userId) {
  const r = await pool.request()
    .input("userId", sql.Int, Number(userId))
    .query(`SELECT TOP 1 id, user_id, full_name FROM dbo.customers WHERE user_id=@userId AND is_active=1 ORDER BY id`);
  return r.recordset[0] || null;
}

const notify = (pool, userId, title, message, type = "RESCHEDULE") => addNotification(pool, userId, title, message, type);
const notifyAdmins = (pool, title, message, type = "RESCHEDULE_REQUEST") => notifyAdminsShared(pool, title, message, type, "reschedule:changed");

async function requestDetails(pool, requestId, user) {
  const r = await pool.request()
    .input("requestId", sql.Int, Number(requestId))
    .query(`
      SELECT
        rr.id,
        rr.appointment_id,
        rr.customer_id,
        rr.current_staff_id,
        rr.requested_staff_id,
        rr.[current_date],
        rr.current_start_time,
        rr.current_end_time,
        rr.requested_date,
        rr.requested_start_time,
        rr.requested_end_time,
        rr.reason,
        rr.status,
        rr.reviewed_by,
        rr.reviewed_at,
        rr.created_at,
        rr.updated_at,
        a.appointment_code,
        a.status AS appointment_status,
        c.full_name AS customer_name,
        c.user_id AS customer_user_id,
        sv.name AS service_name,
        sv.duration_minutes,
        oldst.full_name AS current_staff_name,
        oldst.user_id AS current_staff_user_id,
        newst.full_name AS requested_staff_name,
        newst.user_id AS requested_staff_user_id
      FROM dbo.appointment_reschedule_requests rr
      INNER JOIN dbo.appointments a ON a.id=rr.appointment_id
      INNER JOIN dbo.customers c ON c.id=rr.customer_id
      INNER JOIN dbo.services sv ON sv.id=a.service_id
      LEFT JOIN dbo.staff oldst ON oldst.id=rr.current_staff_id
      INNER JOIN dbo.staff newst ON newst.id=rr.requested_staff_id
      WHERE rr.id=@requestId
    `);
  const row = r.recordset[0];
  if (!row) return null;
  if (user?.role === "STAFF") {
    if (Number(row.requested_staff_id) !== Number(await linkedStaffId(pool, user.id)) && Number(row.current_staff_id) !== Number(await linkedStaffId(pool, user.id))) {
      return null;
    }
  }
  return row;
}

async function linkedStaffId(pool, userId) {
  const r = await pool.request().input("userId", sql.Int, Number(userId)).query(`SELECT TOP 1 id FROM dbo.staff WHERE user_id=@userId AND is_active=1`);
  return r.recordset[0]?.id || null;
}

async function validateRequestedSlot(pool, { serviceId, staffId, date, startTime, excludeAppointmentId = null }) {
  const serviceResult = await pool.request()
    .input("serviceId", sql.Int, Number(serviceId))
    .query(`SELECT TOP 1 id, duration_minutes, name FROM dbo.services WHERE id=@serviceId AND is_active=1`);
  const service = serviceResult.recordset[0];
  if (!service) return { error: "Dịch vụ không tồn tại hoặc đã ngừng cung cấp." };

  const staffResult = await pool.request()
    .input("staffId", sql.Int, Number(staffId))
    .query(`SELECT TOP 1 id, full_name, user_id FROM dbo.staff WHERE id=@staffId AND is_active=1`);
  const staff = staffResult.recordset[0];
  if (!staff) return { error: "Nhân viên không tồn tại hoặc đã ngừng hoạt động." };

  const assignment = await pool.request()
    .input("serviceId", sql.Int, Number(serviceId))
    .input("staffId", sql.Int, Number(staffId))
    .query(`SELECT TOP 1 id FROM dbo.staff_services WHERE service_id=@serviceId AND staff_id=@staffId AND is_active=1`);
  if (!assignment.recordset.length) return { error: "Nhân viên chưa được phân công cho dịch vụ này." };

  const start = minutes(startTime);
  const end = start + Number(service.duration_minutes);
  if (start < 480 || end > 1080) return { error: "Khung giờ mới phải nằm trong 08:00–18:00 và đủ thời lượng dịch vụ." };

  // Cùng quy tắc với đặt lịch mới: không đổi sang quá khứ, sát giờ, hay quá xa.
  const windowError = validateBookingWindow(date, start);
  if (windowError) return { error: windowError };

  const schedule = await getEffectiveSchedules(pool, Number(staffId), date);
  const inside = schedule.some((x) => start >= minutes(x.start_time) && end <= minutes(x.end_time));
  if (!inside) return { error: "Nhân viên không có ca làm phù hợp vào thời gian mới." };

  const request = pool.request()
    .input("staffId", sql.Int, Number(staffId))
    .input("date", sql.Date, date);
  let exclude = "";
  if (excludeAppointmentId) {
    request.input("excludeAppointmentId", sql.Int, Number(excludeAppointmentId));
    exclude = "AND a.id<>@excludeAppointmentId";
  }
  const conflicts = await request.query(`
    SELECT a.id,a.start_time,a.end_time
    FROM dbo.appointments a
    WHERE a.staff_id=@staffId
      AND a.appointment_date=@date
      ${exclude}
      AND a.status IN ('PENDING','CONFIRMED')
  `);
  const conflict = conflicts.recordset.some((x) => {
    const os = minutes(x.start_time);
    const oe = minutes(x.end_time);
    return overlapsWithBuffer(start, end, os, oe, policyConfig().slotBufferMinutes);
  });
  if (conflict) return { error: "Khung giờ mới vừa có người đặt hoặc bị trùng lịch." };

  return { service, staff, start, end, startText: timeText(startTime), endText: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}:00` };
}

/* Customer tạo yêu cầu đổi lịch. Appointment hiện tại vẫn giữ nguyên. */
router.post("/my/:appointmentId", authenticateToken, requireCustomer, async (req, res) => {
  try {
    const appointmentId = Number(req.params.appointmentId);
    const requestedStaffId = Number(req.body?.requestedStaffId);
    const requestedDate = String(req.body?.requestedDate || "").trim();
    const requestedStartTime = String(req.body?.requestedStartTime || "").trim();
    const reason = String(req.body?.reason || "").trim() || "Khách hàng yêu cầu đổi lịch.";

    if (!Number.isInteger(appointmentId) || appointmentId <= 0) return res.status(400).json({ message: "Lịch hẹn không hợp lệ." });
    if (!Number.isInteger(requestedStaffId) || requestedStaffId <= 0) return res.status(400).json({ message: "Nhân viên mới không hợp lệ." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !/^\d{2}:\d{2}$/.test(requestedStartTime)) return res.status(400).json({ message: "Ngày hoặc giờ mới không hợp lệ." });

    const pool = await poolPromise;
    const customer = await getCustomer(pool, req.user.id);
    if (!customer) return res.status(404).json({ message: "Tài khoản chưa có hồ sơ khách hàng." });

    const appt = await pool.request()
      .input("appointmentId", sql.Int, appointmentId)
      .input("customerId", sql.Int, customer.id)
      .query(`
        SELECT TOP 1
          a.id,a.appointment_code,a.customer_id,a.service_id,a.staff_id,a.appointment_date,a.start_time,a.end_time,a.status,
          c.user_id AS customer_user_id,
          st.full_name AS current_staff_name, st.user_id AS current_staff_user_id,
          s.name AS service_name,s.duration_minutes,p.payment_status
        FROM dbo.appointments a
        INNER JOIN dbo.customers c ON c.id=a.customer_id
        INNER JOIN dbo.services s ON s.id=a.service_id
        LEFT JOIN dbo.staff st ON st.id=a.staff_id
        LEFT JOIN dbo.payments p ON p.appointment_id=a.id
        WHERE a.id=@appointmentId AND a.customer_id=@customerId
      `);
    const current = appt.recordset[0];
    if (!current) return res.status(404).json({ message: "Không tìm thấy lịch hẹn của bạn." });
    if (!['PENDING','CONFIRMED'].includes(String(current.status).toUpperCase())) return res.status(409).json({ message: "Chỉ được yêu cầu đổi lịch PENDING hoặc CONFIRMED." });

    // Chính sách đổi lịch: lịch đã xác nhận/đã trả tiền phải đổi trước giờ hẹn tối thiểu N giờ.
    const policy = checkCustomerChange({
      date: new Date(current.appointment_date).toISOString().slice(0, 10),
      time: timeText(current.start_time),
      status: current.status,
      paid: String(current.payment_status || "").toUpperCase() === "PAID",
    }, "reschedule");
    if (!policy.ok) return res.status(403).json({ message: policy.message, code: "RESCHEDULE_WINDOW_CLOSED" });

    const pending = await pool.request().input("appointmentId", sql.Int, appointmentId).query(`SELECT TOP 1 id FROM dbo.appointment_reschedule_requests WHERE appointment_id=@appointmentId AND status='REQUESTED'`);
    if (pending.recordset.length) return res.status(409).json({ message: "Lịch này đang có một yêu cầu đổi lịch chờ xử lý." });

    const checked = await validateRequestedSlot(pool, {
      serviceId: current.service_id,
      staffId: requestedStaffId,
      date: requestedDate,
      startTime: requestedStartTime,
      excludeAppointmentId: appointmentId,
    });
    if (checked.error) return res.status(409).json({ message: checked.error });

    const requestedEndTime = checked.endText;
    const inserted = await pool.request()
      .input("appointmentId", sql.Int, appointmentId)
      .input("customerId", sql.Int, customer.id)
      .input("currentStaffId", sql.Int, current.staff_id ?? null)
      .input("requestedStaffId", sql.Int, requestedStaffId)
      .input("currentDate", sql.Date, current.appointment_date)
      .input("currentStartTime", sql.VarChar, timeText(current.start_time))
      .input("currentEndTime", sql.VarChar, timeText(current.end_time))
      .input("requestedDate", sql.Date, requestedDate)
      .input("requestedStartTime", sql.VarChar, requestedStartTime)
      .input("requestedEndTime", sql.VarChar, requestedEndTime)
      .input("reason", sql.NVarChar, reason.slice(0, 500))
      .query(`
        INSERT INTO dbo.appointment_reschedule_requests
        (appointment_id,customer_id,current_staff_id,requested_staff_id,[current_date],current_start_time,current_end_time,requested_date,requested_start_time,requested_end_time,reason)
        OUTPUT INSERTED.id
        VALUES(@appointmentId,@customerId,@currentStaffId,@requestedStaffId,@currentDate,@currentStartTime,@currentEndTime,@requestedDate,@requestedStartTime,@requestedEndTime,@reason)
      `);

    const requestId = inserted.recordset[0].id;
    const message = `Khách ${customer.full_name} yêu cầu đổi lịch ${current.appointment_code}: ${current.appointment_date instanceof Date ? current.appointment_date.toISOString().slice(0,10) : String(current.appointment_date).slice(0,10)} ${timeText(current.start_time)} → ${requestedDate} ${requestedStartTime}, nhân viên ${checked.staff.full_name}.`;
    await notify(pool, req.user.id, "Đã gửi yêu cầu đổi lịch", message, "RESCHEDULE_REQUESTED");
    await notify(pool, checked.staff.user_id, "Có yêu cầu đổi lịch", message, "RESCHEDULE_REQUESTED");
    await notifyAdmins(pool, "Có yêu cầu đổi lịch mới", message, "RESCHEDULE_REQUESTED");
    await writeAudit(pool, { userId:req.user.id, action:"REQUEST_RESCHEDULE", entityType:"APPOINTMENT", entityId:appointmentId, description:`Request #${requestId}: ${requestedDate} ${requestedStartTime}, staff=${requestedStaffId}.`, req });

    res.status(201).json({ message: "Đã gửi yêu cầu đổi lịch. Lịch hiện tại vẫn được giữ nguyên cho đến khi được duyệt.", requestId });
  } catch (error) {
    console.error("POST reschedule request:", error);
    if (error?.number === 2601 || error?.number === 2627) return res.status(409).json({ message: "Lịch này đang có yêu cầu đổi lịch chờ xử lý." });
    res.status(500).json({ message: "Không thể gửi yêu cầu đổi lịch." });
  }
});

router.get("/my", authenticateToken, requireCustomer, async (req,res)=>{
  try{
    const pool=await poolPromise;
    const customer=await getCustomer(pool,req.user.id);
    if(!customer)return res.status(404).json({message:"Chưa có hồ sơ khách hàng."});
    const r=await pool.request().input("customerId",sql.Int,customer.id).query(`
      SELECT rr.*,a.appointment_code,s.name AS service_name,st.full_name AS requested_staff_name
      FROM dbo.appointment_reschedule_requests rr
      JOIN dbo.appointments a ON a.id=rr.appointment_id
      JOIN dbo.services s ON s.id=a.service_id
      JOIN dbo.staff st ON st.id=rr.requested_staff_id
      WHERE rr.customer_id=@customerId
      ORDER BY rr.created_at DESC
    `);
    res.json(r.recordset.map(x=>({...x,current_start_time:timeText(x.current_start_time),current_end_time:timeText(x.current_end_time),requested_start_time:timeText(x.requested_start_time),requested_end_time:timeText(x.requested_end_time)})));
  }catch(error){console.error("GET my reschedule requests:",error);res.status(500).json({message:"Không tải được yêu cầu đổi lịch."});}
});

router.get("/", authenticateToken, requireAdminOrStaff, async (req,res)=>{
  try{
    const pool=await poolPromise;
    let where="";
    const request=pool.request();
    if(req.user.role === "STAFF"){
      const staffId=await linkedStaffId(pool,req.user.id);
      if(!staffId)return res.status(404).json({message:"Tài khoản STAFF chưa được liên kết."});
      request.input("staffId",sql.Int,Number(staffId));
      where="AND (rr.current_staff_id=@staffId OR rr.requested_staff_id=@staffId)";
    }
    const r=await request.query(`
      SELECT TOP 200
        rr.id,rr.appointment_id,rr.customer_id,rr.current_staff_id,rr.requested_staff_id,
        rr.[current_date],rr.current_start_time,rr.current_end_time,rr.requested_date,rr.requested_start_time,rr.requested_end_time,
        rr.reason,rr.status,rr.reviewed_by,rr.reviewed_at,rr.created_at,
        a.appointment_code,a.status AS appointment_status,s.name AS service_name,
        c.full_name AS customer_name,c.phone AS customer_phone,
        oldst.full_name AS current_staff_name,newst.full_name AS requested_staff_name
      FROM dbo.appointment_reschedule_requests rr
      JOIN dbo.appointments a ON a.id=rr.appointment_id
      JOIN dbo.customers c ON c.id=rr.customer_id
      JOIN dbo.services s ON s.id=a.service_id
      LEFT JOIN dbo.staff oldst ON oldst.id=rr.current_staff_id
      JOIN dbo.staff newst ON newst.id=rr.requested_staff_id
      WHERE 1=1 ${where}
      ORDER BY CASE WHEN rr.status='REQUESTED' THEN 0 ELSE 1 END, rr.created_at DESC
    `);
    res.json(r.recordset.map(x=>({...x,current_date:new Date(x.current_date).toISOString().slice(0,10),requested_date:new Date(x.requested_date).toISOString().slice(0,10),current_start_time:timeText(x.current_start_time),current_end_time:timeText(x.current_end_time),requested_start_time:timeText(x.requested_start_time),requested_end_time:timeText(x.requested_end_time)})));
  }catch(error){console.error("GET reschedule requests:",error);res.status(500).json({message:"Không tải được yêu cầu đổi lịch."});}
});

router.patch("/:id/approve", authenticateToken, requireAdminOrStaff, async (req,res)=>{
  try{
    const requestId=Number(req.params.id);
    const pool=await poolPromise;
    const requestDetail=await requestDetails(pool,requestId,req.user);
    if(!requestDetail)return res.status(404).json({message:"Không tìm thấy yêu cầu đổi lịch hoặc bạn không có quyền xử lý."});
    if(String(requestDetail.status).toUpperCase()!=="REQUESTED")return res.status(409).json({message:"Yêu cầu này không còn ở trạng thái chờ xử lý."});
    if(!["PENDING","CONFIRMED"].includes(String(requestDetail.appointment_status).toUpperCase()))return res.status(409).json({message:"Lịch hẹn hiện tại không còn cho phép đổi lịch."});

    const tx=new sql.Transaction(pool);
    let approvedFromStatus=null;
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try{
      const detail=new sql.Request(tx).input("requestId",sql.Int,requestId);
      const locked=(await detail.query(`
        SELECT TOP 1 rr.*,a.service_id,a.status AS appointment_status,a.price_at_booking,a.appointment_code,c.user_id AS customer_user_id,
        currentst.user_id AS current_staff_user_id,newst.user_id AS requested_staff_user_id,newst.full_name AS requested_staff_name,s.duration_minutes,s.name AS service_name
        FROM dbo.appointment_reschedule_requests rr WITH (UPDLOCK,HOLDLOCK)
        JOIN dbo.appointments a WITH (UPDLOCK,HOLDLOCK) ON a.id=rr.appointment_id
        JOIN dbo.customers c ON c.id=rr.customer_id
        LEFT JOIN dbo.staff currentst ON currentst.id=rr.current_staff_id
        JOIN dbo.staff newst ON newst.id=rr.requested_staff_id
        JOIN dbo.services s ON s.id=a.service_id
        WHERE rr.id=@requestId
      `)).recordset[0];
      if(!locked||locked.status!=="REQUESTED"){await tx.rollback();return res.status(409).json({message:"Yêu cầu vừa được xử lý. Vui lòng tải lại."});}

      // Trạng thái lịch có thể đã đổi (hủy/hoàn thành) giữa lúc kiểm tra và lúc khóa dòng: kiểm tra lại trong transaction.
      if(!["PENDING","CONFIRMED"].includes(String(locked.appointment_status).toUpperCase())){await tx.rollback();return res.status(409).json({message:"Lịch hẹn hiện tại không còn cho phép đổi lịch."});}

      const schedule=await getEffectiveSchedules(pool, locked.requested_staff_id, locked.requested_date, tx);
      const start=minutes(locked.requested_start_time);
      const end=minutes(locked.requested_end_time);
      const requestedDateText=new Date(locked.requested_date).toISOString().slice(0,10);
      const windowError=validateBookingWindow(requestedDateText,start);
      if(windowError){await tx.rollback();return res.status(409).json({message:`Không thể duyệt: ${windowError} Hãy từ chối và yêu cầu khách chọn lại.`});}
      if(!schedule.some(x=>start>=minutes(x.start_time)&&end<=minutes(x.end_time))){await tx.rollback();return res.status(409).json({message:"Nhân viên không còn ca phù hợp cho yêu cầu này."});}

      const conflicts=(await new sql.Request(tx)
        .input("staffId",sql.Int,locked.requested_staff_id)
        .input("date",sql.Date,locked.requested_date)
        .input("appointmentId",sql.Int,locked.appointment_id)
        .query(`SELECT start_time,end_time FROM dbo.appointments WITH (UPDLOCK,HOLDLOCK) WHERE staff_id=@staffId AND appointment_date=@date AND id<>@appointmentId AND status IN ('PENDING','CONFIRMED')`)).recordset;
      const hasConflict=conflicts.some(x=>overlapsWithBuffer(start,end,minutes(x.start_time),minutes(x.end_time),policyConfig().slotBufferMinutes));
      if(hasConflict){await tx.rollback();return res.status(409).json({message:"Khung giờ được yêu cầu đã có lịch khác. Từ chối yêu cầu và yêu cầu khách chọn lại."});}

      const oldStatus=String(locked.appointment_status).toUpperCase();
      approvedFromStatus=oldStatus;
      const newStatus=oldStatus;
      await new sql.Request(tx)
        .input("requestId",sql.Int,requestId)
        .input("appointmentId",sql.Int,locked.appointment_id)
        .input("oldStatus",sql.VarChar,oldStatus)
        .input("newStatus",sql.VarChar,newStatus)
        .input("staffId",sql.Int,locked.requested_staff_id)
        .input("date",sql.Date,locked.requested_date)
        .input("start",sql.VarChar,timeText(locked.requested_start_time))
        .input("end",sql.VarChar,timeText(locked.requested_end_time))
        .input("changedBy",sql.Int,Number(req.user.id))
        .input("reason",sql.NVarChar,String(locked.reason||"Duyệt yêu cầu đổi lịch").slice(0,500))
        .query(`
          INSERT INTO dbo.appointment_reschedules
            (appointment_id,old_date,old_start_time,old_end_time,new_date,new_start_time,new_end_time,changed_by,reason)
          SELECT @appointmentId,[current_date],current_start_time,current_end_time,@date,@start,@end,@changedBy,@reason
          FROM dbo.appointment_reschedule_requests
          WHERE id=@requestId;

          UPDATE dbo.appointments
          SET staff_id=@staffId,appointment_date=@date,start_time=@start,end_time=@end,
              status=@newStatus,
              confirmed_at=CASE WHEN @newStatus='CONFIRMED' THEN COALESCE(confirmed_at,SYSDATETIME()) ELSE confirmed_at END,
              updated_at=SYSDATETIME()
          WHERE id=@appointmentId AND status=@oldStatus;

          INSERT INTO dbo.appointment_status_history
            (appointment_id,old_status,new_status,changed_by,reason)
          VALUES
            (@appointmentId,@oldStatus,@newStatus,@changedBy,N'Yêu cầu đổi lịch được duyệt; giữ nguyên trạng thái nghiệp vụ hiện tại.');

          UPDATE dbo.appointment_reschedule_requests
          SET status='APPROVED',reviewed_by=@changedBy,reviewed_at=SYSDATETIME(),updated_at=SYSDATETIME()
          WHERE id=@requestId AND status='REQUESTED';
        `);
      await tx.commit();

      const msg=`Yêu cầu đổi lịch ${locked.appointment_code} đã được duyệt. Lịch mới: ${new Date(locked.requested_date).toISOString().slice(0,10)} ${timeText(locked.requested_start_time)}, nhân viên: ${locked.requested_staff_name}. Trạng thái: ${approvedFromStatus}.`;
      await notify(pool,locked.customer_user_id,"Đổi lịch đã được duyệt",msg,"RESCHEDULE_APPROVED");
      await notify(pool,locked.requested_staff_user_id,"Lịch mới được phân công",`${locked.appointment_code} đã được chuyển sang lịch ${new Date(locked.requested_date).toISOString().slice(0,10)} ${timeText(locked.requested_start_time)}. Trạng thái hiện tại: ${approvedFromStatus}.`,`RESCHEDULE_APPROVED`);
      if(locked.current_staff_user_id&&locked.current_staff_user_id!==locked.requested_staff_user_id)await notify(pool,locked.current_staff_user_id,"Lịch đã được chuyển cho nhân viên khác",`${locked.appointment_code} không còn thuộc lịch của bạn (đã đổi sang ${locked.requested_staff_name}).`,"RESCHEDULE_APPROVED");
      if(req.user.role==="STAFF")await notifyAdmins(pool,"STAFF đã duyệt đổi lịch",msg,"RESCHEDULE_APPROVED");
      await writeAudit(pool,{userId:req.user.id,action:"APPROVE_RESCHEDULE",entityType:"RESCHEDULE_REQUEST",entityId:requestId,description:msg,req});
      res.json({message:"Đã duyệt yêu cầu đổi lịch."});
    }catch(error){try{await tx.rollback();}catch{};throw error;}
  }catch(error){console.error("PATCH approve reschedule:",error);res.status(500).json({message:"Không thể duyệt yêu cầu đổi lịch."});}
});

router.patch("/:id/reject", authenticateToken, requireAdminOrStaff, async (req,res)=>{
  try{
    const requestId=Number(req.params.id);
    const reason=String(req.body?.reason||"").trim()||"Không thể đáp ứng khung giờ được yêu cầu.";
    const pool=await poolPromise;
    const row=await requestDetails(pool,requestId,req.user);
    if(!row)return res.status(404).json({message:"Không tìm thấy yêu cầu đổi lịch hoặc bạn không có quyền xử lý."});
    if(String(row.status).toUpperCase()!=="REQUESTED")return res.status(409).json({message:"Yêu cầu này không còn ở trạng thái chờ xử lý."});
    await pool.request().input("id",sql.Int,requestId).input("reviewedBy",sql.Int,Number(req.user.id)).input("reason",sql.NVarChar,reason.slice(0,500)).query(`UPDATE dbo.appointment_reschedule_requests SET status='REJECTED',reviewed_by=@reviewedBy,reviewed_at=SYSDATETIME(),updated_at=SYSDATETIME(),reason=CONCAT(COALESCE(reason,N''),N' | Từ chối: ',@reason) WHERE id=@id AND status='REQUESTED'`);
    await notify(pool,row.customer_user_id,"Yêu cầu đổi lịch bị từ chối",`Yêu cầu đổi lịch ${row.appointment_code} chưa được chấp nhận. Lý do: ${reason}`,"RESCHEDULE_REJECTED");
    if(req.user.role==="STAFF")await notifyAdmins(pool,"STAFF từ chối yêu cầu đổi lịch",`Lịch ${row.appointment_code} đã bị từ chối đổi lịch.`,"RESCHEDULE_REJECTED");
    await writeAudit(pool,{userId:req.user.id,action:"REJECT_RESCHEDULE",entityType:"RESCHEDULE_REQUEST",entityId:requestId,description:reason,req});
    res.json({message:"Đã từ chối yêu cầu đổi lịch."});
  }catch(error){console.error("PATCH reject reschedule:",error);res.status(500).json({message:"Không thể từ chối yêu cầu đổi lịch."});}
});

router.patch("/:id/cancel", authenticateToken, requireCustomer, async (req,res)=>{
  try{
    const requestId=Number(req.params.id);
    const pool=await poolPromise;
    const customer=await getCustomer(pool,req.user.id);
    if(!customer)return res.status(404).json({message:"Chưa có hồ sơ khách hàng."});
    const r=await pool.request().input("id",sql.Int,requestId).input("customerId",sql.Int,customer.id).query(`UPDATE dbo.appointment_reschedule_requests SET status='CANCELLED',updated_at=SYSDATETIME() OUTPUT INSERTED.id WHERE id=@id AND customer_id=@customerId AND status='REQUESTED'`);
    if(!r.rowsAffected[0])return res.status(404).json({message:"Không tìm thấy yêu cầu đổi lịch đang chờ."});
    res.json({message:"Đã hủy yêu cầu đổi lịch."});
  }catch(error){console.error("PATCH cancel reschedule:",error);res.status(500).json({message:"Không thể hủy yêu cầu đổi lịch."});}
});

export default router;
