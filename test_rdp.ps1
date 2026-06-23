try {
  $socket = New-Object System.Net.Sockets.TcpClient
  $socket.ConnectAsync('127.0.0.1', 3380).Wait(5000) | Out-Null
  if ($socket.Connected) {
    Write-Output "TCP connected!"
    $stream = $socket.GetStream()
    $stream.ReadTimeout = 5000
    [byte[]]$req = @(0x01, 0x00, 0x00, 0x08, 0x03, 0x00, 0x00, 0x00)
    Write-Output "Sending RDP_NEG_REQ with SSL|HYBRID"
    $stream.Write($req, 0, 8)
    $stream.Flush()
    $buf = New-Object byte[] 1024
    try {
      $read = $stream.Read($buf, 0, 1024)
      if ($read -gt 0) {
        Write-Output "Got response ($read bytes)"
        for ($i = 0; $i -lt $read; $i++) { Write-Output "  byte[$i] = 0x$('{0:X2}' -f $buf[$i])" }
        if ($read -ge 8) {
          if ($buf[0] -eq 2) { Write-Output "Response type: RDP_NEG_RSP" }
          elseif ($buf[0] -eq 3) { Write-Output "Response type: RDP_NEG_FAILURE" }
          else { Write-Output "Response type: 0x$('{0:X2}' -f $buf[0])" }
          $respProtocol = $buf[4]
          Write-Output "Selected protocol: 0x$('{0:X2}' -f $respProtocol)"
          if ($respProtocol -eq 0) { Write-Output " -> SSL/TLS" }
          elseif ($respProtocol -eq 1) { Write-Output " -> TLS" }
          elseif ($respProtocol -eq 2) { Write-Output " -> NLA/HYBRID" }
          elseif ($respProtocol -eq 3) { Write-Output " -> RDSTLS" }
          else { Write-Output " -> Unknown" }
        }
      } else { Write-Output "No response (connection closed)" }
    } catch { Write-Output "Read timeout: no response in 5s" }
    $stream.Close()
  } else { Write-Output "TCP connection FAILED" }
  $socket.Dispose()
} catch { Write-Output "Error: $($_.Exception.Message)" }
