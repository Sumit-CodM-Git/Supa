CREATE OR REPLACE FUNCTION public.visitor_ready_for_resident_approval(p_visitor public."SSP_Non_Society_User")
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(p_visitor.is_otp_verified,false)
    AND lower(coalesce(p_visitor.role,''))='visitor'
    AND p_visitor.hosted_by IS NOT NULL
    AND NOT coalesce(p_visitor.pre_approved,false)
    AND trim(coalesce(p_visitor.phone_number,''))<>''
    AND lower(coalesce(p_visitor.visitor_status,''))='pending'
    AND lower(coalesce(p_visitor.visitor_approval_status,'pending'))='pending';
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_resident(
  p_new public."SSP_Non_Society_User", p_old public."SSP_Non_Society_User"
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE v_display_name text;
BEGIN
  IF p_old IS NOT NULL OR NOT public.visitor_ready_for_resident_approval(p_new) THEN RETURN; END IF;
  v_display_name:=trim(coalesce(p_new.name,''));
  IF lower(v_display_name) IN ('','unknown','unknown visitor') THEN
    v_display_name:=format('Visitor (%s)',p_new.phone_number);
  END IF;
  PERFORM public.create_notification(
    p_title:='Visitor Approval Required',
    p_message:=format('%s is waiting for your approval.',v_display_name),
    p_notification_type:='VISITOR_APPROVAL_REQUEST',
    p_recipient_id:=p_new.hosted_by,
    p_recipient_type:='Resident',
    p_sender_id:=p_new.approver,
    p_sender_type:=CASE WHEN p_new.approver IS NOT NULL THEN 'Security' ELSE 'System' END,
    p_reference_table:='SSP_Non_Society_User',p_reference_id:=p_new.non_society_user_id,
    p_society_id:=p_new.society,p_navigation_screen:='/visitor-details',p_priority:='high',
    p_dedup_key:=concat('visitor-approval-request:',p_new.non_society_user_id),
    p_action_data:=jsonb_build_object('screen','visitor-details','visitorId',p_new.non_society_user_id),
    p_extra_data:=jsonb_build_object('visitorId',p_new.non_society_user_id,'visitorName',v_display_name,
      'phoneNumber',p_new.phone_number,'purpose',p_new.purpose,'hostedBy',p_new.hosted_by,
      'approver',p_new.approver,'approvalStatus',coalesce(p_new.visitor_approval_status,'pending'),
      'visitorStatus',p_new.visitor_status,'preApproved',p_new.pre_approved)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_notify_resident(): %',SQLERRM;
END;
$$;
