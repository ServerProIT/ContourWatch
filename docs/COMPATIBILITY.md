# Совместимость: документальная и фактическая

Состояние на 13 ноября 2026 года. Успешная компиляция не считается проверкой ОС.

| Платформа | Основание выбора | Фактическая проверка |
|---|---|---|
| Windows 10 x64 | .NET Framework 4.8 по Microsoft | Нет отдельной тестовой машины |
| Windows 11 x64 | .NET Framework 4.8/4.8.1 | На текущем Windows-хосте проверены сборка, RAM, 2 тома, консольный сетевой сценарий; точная редакция ОС в отчёте не аттестована |
| Server 2012 / 2012 R2 x64 | Microsoft предусматривает установку .NET Framework 4.8 | Не проверено; runtime не означает действующий lifecycle ОС |
| Server 2016 / 2019 / 2022 x64 | .NET Framework 4.8 по таблице Microsoft | Не проверено |
| Новые Windows Server | Требуется сверка конкретной редакции и роли | Не проверено, без автоматического заявления поддержки |
| Ubuntu 22.04/24.04, Debian 12/13, Rocky Linux 9 x86_64 | Python 3.9+, systemd, smartmontools, lm-sensors | Проверена только переносимая логика с подставными данными на Windows; установка/Linux-оборудование не проверены |
| Windows/Linux x86, Linux ARM64 | Отдельная оценка | Не заявлены для этой поставки |

Исходный Windows-код использует старые системные API и компилируется встроенным Framework CSC, а app.config требует .NET Framework 4.8. Установщик проверяет runtime. Поддержку Server Core необходимо проверять отдельно для службы и установщика; интерактивный WinForms и трей нельзя считать доступными на Core.

Источники проверки стека:

- Microsoft, [.NET Framework system requirements](https://learn.microsoft.com/en-us/dotnet/framework/get-started/system-requirements).
- Microsoft, [.NET Framework 4.8 for Windows Server 2012](https://support.microsoft.com/en-us/topic/microsoft-net-framework-4-8-for-windows-server-2012-ffc7ea09-24e4-76ce-648f-290617580544).
- Microsoft, [определение установленной версии](https://learn.microsoft.com/en-us/dotnet/framework/migration-guide/how-to-determine-which-versions-are-installed).
- LibreHardwareMonitor, [проект библиотеки](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LibreHardwareMonitorLib/LibreHardwareMonitorLib.csproj): есть цель net472; это только совместимость уровня .NET, не подтверждение драйвера/Server 2012.
- LibreHardwareMonitor, [официальные выпуски](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases). Ни один выпуск с драйвером в эту сборку не включён. Требуется выбор фиксированного релиза, аудит PawnIO/других используемых драйверов и тест с Windows Secure Boot/HVCI. Защита не отключается.
- smartmontools, [исходник руководства smartctl](https://github.com/smartmontools/smartmontools/blob/master/smartmontools/smartctl.8.in): JSON, ATA/SCSI/NVMe и битовая маска exit status. Ненулевой статус SMART не равен ошибке запуска.
- systemd, [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html).
- Node.js, [SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).

Недоступный датчик имеет value=null и явный state: unsupported, denied, error или stale. Ноль оборотов — допустимое измерение, не автоматическая поломка. Износ SSD не преобразуется в выдуманный «процент здоровья». Предупреждения SMART — признаки риска, отсутствие предупреждений не гарантирует исправности. VM определяется по доступным признакам, отрицательный результат определения не доказывает физическую машину. Redfish/iDRAC/iLO и vendor RAID-адаптеры в 0.1.0 не реализованы.
