// Only for UserChromeRules.uc.js

(function() {
  window.UCM_I18N.update({
    menu_label: "UC 管理器",
    btn_add: "新增",
    btn_export: "导出",
    btn_import: "导入",
    btn_backup: "备份",
    btn_folder: "目录",
    btn_restart: "重启",
    btn_exit: "退出",
    btn_modify: "修改",
    btn_delete: "删除",
    btn_ok: "确定",
    btn_cancel: "取消",
    placeholder_name: "规则名称",
    tip_restart_js: "此规则需要重启浏览器才能完全禁用。",
    confirm_restart: "确定要重启 Firefox 吗？",
    confirm_delete: (type, name) => `确定删除 ${type} 项 "${name}" 吗？`,
    confirm_overwrite: "备份文件已存在，是否覆盖？",
    msg_export_ok: (n) => `成功导出 ${n} 条规则。`,
    msg_backup_ok: "备份成功！",
    picker_folder: "选择导出文件夹",
    picker_file: "选择文件",
    picker_type: "文件类型"
  });
  return () => window.UCM_I18N.reset();
})();
