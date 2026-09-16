FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/lyrenthos-gateway .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/lyrenthos-gateway /lyrenthos-gateway
EXPOSE 8080
ENTRYPOINT ["/lyrenthos-gateway"]
