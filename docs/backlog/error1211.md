
[vite] connecting... client:495:9
[vite] connected. client:618:15
Download the React DevTools for a better development experience: https://reactjs.org/link/react-devtools react-dom.development.js:29895:17
⚠️ React Router Future Flag Warning: React Router will begin wrapping state updates in `React.startTransition` in v7. You can use the `v7_startTransition` future flag to opt-in early. For more information, see https://reactrouter.com/v6/upgrading/future#v7_starttransition. deprecations.ts:9:13
⚠️ React Router Future Flag Warning: Relative route resolution within Splat routes is changing in v7. You can use the `v7_relativeSplatPath` future flag to opt-in early. For more information, see https://reactrouter.com/v6/upgrading/future#v7_relativesplatpath. deprecations.ts:9:13
Firefox가 http://localhost:8810/api/v1/events/stream 서버에 연결할 수 없습니다. 12 useEventSource.ts:113:25
XHRGET
http://localhost:8810/api/v1/events/stream
[HTTP/1.1 401 Unauthorized 4ms]

Firefox가 http://localhost:8810/api/v1/events/stream 서버에 연결할 수 없습니다. 2 useEventSource.ts:113:25
XHRGET
http://localhost:8810/api/v1/admin/environments?active_only=false
[HTTP/1.1 401 Unauthorized 4ms]

Failed to load environments: 
Object { message: "Request failed with status code 401", name: "AxiosError", code: "ERR_BAD_REQUEST", config: {…}, request: XMLHttpRequest, response: {…}, status: 401, stack: "", … }
AdminEnvironments.tsx:65:15
GET
	http://localhost:8810/api/v1/admin/environments?active_only=false
상태
401
Unauthorized
버전HTTP/1.1
전송됨413 B (0 B 크기)
리퍼러 정책strict-origin-when-cross-origin
요청 우선 순위Highest
DNS 확인시스템

	
Access-Control-Allow-Origin
	*
cache-control
	no-cache, no-store, max-age=0, must-revalidate
connection
	close
content-length
	0
Date
	Thu, 11 Dec 2025 18:58:24 GMT
expires
	0
pragma
	no-cache
referrer-policy
	no-referrer
vary
	Origin, Access-Control-Request-Method, Access-Control-Request-Headers
x-content-type-options
	nosniff
x-frame-options
	DENY
x-xss-protection
	0
	
Accept
	application/json, text/plain, */*
Accept-Encoding
	gzip, deflate, br, zstd
Accept-Language
	ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3
Connection
	keep-alive
Cookie
	refresh_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwiaXNzIjoiY2Fwc3RvbmUtb3NpbnQiLCJpYXQiOjE3NjU0NzkwOTUsImV4cCI6MTc2NjA4Mzg5NSwidHlwZSI6InJlZnJlc2giLCJqdGkiOiJmOTU2NzE3NC04NmE5LTQ5ZmUtYjY1My0zZWFhODA4NzRmNDcifQ.hjOWL6cU1rAw1MGVWP1W1HMYNHJGLYRwinUtozeGqhc; sidebar:state=true
Host
	localhost:8810
Priority
	u=0
Referer
	http://localhost:8810/admin/environments
Sec-Fetch-Dest
	empty
Sec-Fetch-Mode
	cors
Sec-Fetch-Site
	same-origin
User-Agent
	Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0
----
오류 내용 추론
----
오류1 : 전체 401 에러는 현재 인증/인가의 제대로 된 동작이 안 되고 있는 것으로 판단됨
오류2 : 메인화면의 ?mode=<키워드> url 을 사용하는 모든 기능이 작동하지 않음
오류3 : 초기 메인화면의 검색창에 키워드 넣고 검색하면 ?mode=unified 으로 리디렉션되고 기능은 작동안함
---

